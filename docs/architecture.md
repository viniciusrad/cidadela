# Arquitetura

## Visao geral

`pfrm-secure-agents` e a evolucao do experimento `pfrm-chat` para um fluxo proximo de producao: usuarios autenticados conversam apenas com o agente do proprio setor; respostas podem delegar contexto a outros setores via RabbitMQ; o historico fica em Postgres; a base de conhecimento de cada setor fica isolada em colecoes proprias no Qdrant; entidades, procedimentos e suas relacoes ficam em Neo4j; e integracoes externas (automacao com captcha humano, busca em farmacia, MCP-EDI) acontecem por HTTP autenticado na rede Docker interna. Nao descrever este app como bootstrap ou MVP: e a aplicacao ativa em uso.

## Componentes principais

- `app/` -> paginas autenticadas, login, dashboard `/` por papel, paginas `/admin/*` (curadoria, consolidacao, knowledge-graph, process-automation-map, feedback, audit, knowledge-owners, agents, content, corrections) e APIs HTTP.
- `components/` -> shells (`secure-app-shell`, dashboard) e workbenches (`secure-chat-workbench`, `sector-ingestion-workbench`, `curation-tabs`/`curation-review-workbench`, `consolidation-workbench`, `process-gaps-workbench`, `graph-visualization`, `living-docs-tab`, `agent-control-center`, `content-manager`).
- `lib/config.ts` -> validacao central de ambiente, limites de upload e mapeamento de colecoes Qdrant por setor (incluindo setores dinamicos).
- `lib/agents/` -> personas, protocolos, regras de roteamento e `effective.ts` (merge de overrides do `AgentConfig` sobre defaults).
- `lib/bus/` -> conexao RabbitMQ, topologia, consumers e emissao de eventos/auditoria; `ensureBusBootstrapped` sincroniza protocolos/colecoes na primeira chamada.
- `lib/db/` -> acesso Prisma para conversas, mensagens, usuarios, auditoria, curadoria, feedback, automacoes e mapas de processo.
- `lib/curation/` -> staging-to-promote, calculo de SOP-readiness e renderizacao do artefato fisico.
- `lib/graph/` -> persistencia Neo4j (`Document`, `RagChunk`, entidades, `HAS_RAG_CHUNK`), extracao por regex+Ollama, reclassificacao de pessoas.
- `lib/integrations/` -> clientes HTTP externos: `human-captcha.ts`, `pharmacy-search.ts`, `mcp-edi.ts`.
- `lib/automation/` -> deteccao deterministica de intent: `mcp-edi-intent`, `pharmacy-price-intent`, `cervello-ticket`, `approval`.
- `lib/notifications/` -> Teams (MessageCard + Power Automate Workflows), digest diario/semanal, scheduler iniciado por `instrumentation.ts`, indice de pendencias por owner.
- `lib/pilot/` -> snapshot de KPIs do piloto; safe-by-default quando `PILOT_USER_EMAILS` esta vazio.
- `lib/dashboard/` -> `greeting.ts` e `metrics.ts` com `safe()` (timeout 1500ms) para SSR resiliente do painel.
- `lib/qdrant.ts`, `lib/ollama.ts`, `lib/document*.ts`, `lib/pdf.ts`, `lib/word.ts`, `lib/markdown.ts` -> RAG, embeddings, parsing e chunking.
- `prisma/schema.prisma` -> contratos persistidos (usuarios, conversas, mensagens, agent calls, audit, protocolos, curacao, feedback, knowledge owners, agent config, automation candidates, process maps, process gap questions, knowledge capabilities, chunk feedbacks, document correlation runs, sector definitions).
- `seed-docs/` -> corpus inicial por setor; base do `measure:kpi-baseline`.
- `tests/` -> Vitest cobrindo roteamento, protocolos, ingestao, curadoria, intent MCP-EDI, notificacoes Teams, persistencia em grafo e snapshot do piloto.

## Tres stores, uma cadeia de verdade

O estado de um documento vive simultaneamente em Postgres, Qdrant e Neo4j; mutacoes que afetam identidade/titulo precisam propagar pelos tres.

- **Postgres** (`CurationDocument` + `DocumentReview` + `DocumentApproval` + `AuditEvent`) -> ciclo de vida e auditoria.
- **Qdrant** -> chunks; `rag_<setor>` para producao e `rag_<setor>_staging` para curadoria. Payload carrega `document_type`, `authority_level`, `sensitivity`, `topic`, `owner`, `sourceDocumentId` e campos de proveniencia para o grafo (`rag_collection`, `rag_point_id`, `rag_chunk_ref`, `graph_document_id`, `graph_source_document_id`, `graph_chunk_node_id`).
- **Neo4j** -> nos `Document`, `RagChunk`, `Concept`, `Procedure`, `System`, `Person` e arestas `HAS_RAG_CHUNK`, `INVOLVES_PERSON`, `CO_MENTIONED` (associacoes virtuais por co-mencao).

`PATCH /api/admin/documents/[id]/title` (`updateDocumentTitleInQdrant` + Neo4j `SET d.title` + atualizacao do `CurationDocument` + audit em `DocumentReview`) e o padrao validado de mutacao tripla. Reutilizar esse padrao; nao implementar variantes parciais.

## Fluxo do chat autenticado

`app/api/chat/route.ts` e a espinha. Em ordem:

1. Sessao Auth.js -> resolver/criar conversa -> persistir mensagem do usuario.
2. `ensureBusBootstrapped()` (lazy): topologia RabbitMQ, colecoes Qdrant e sincronizacao de protocolos. Conhecida divida: mistura inicializacao com trafego.
3. Branch MCP-EDI: quando o setor esta em `MCP_EDI_ALLOWED_SECTORS` (default `desenvolvimento`), `detectMcpEdiIntent()` identifica CNPJ/idoc/processo/codigo/nome com precedencia idoc > processo > cnpj > codigo > nome; o resultado e injetado como `ExternalAgentContext` com `allowDelegation=false`. Eventos: `mcp_edi.lookup.requested|completed|failed`.
4. Branch farmacia: `detectPharmacyPriceIntent()` para consultas de preco de medicamentos no setor `suporte`.
5. `detectHumanCaptchaAutomationIntent()` para comandos explicitos de execucao de automacao.
6. `runSectorAgent()`: primeiro tenta o RAG do proprio setor. Se nao houver chunks relevantes ou o melhor score local ficar abaixo de `CHAT_LOCAL_CONFIDENCE_THRESHOLD` (default `0.50`), faz fanout para todos os outros setores via protocolos ativos, filtrando para documentos promovidos com `sensitivity` `public`/`internal`. O agente respondente atribui explicitamente o contexto delegado a persona do setor consultado.
7. Retrieval flexivel: a UI permite alternar `RAG ON/OFF` e `Grafo ON/OFF`. `RAG OFF + Grafo ON` usa Neo4j para selecionar documentos por relacao e le o conteudo promovido em Postgres sem embeddings. `RAG OFF + Grafo OFF` faz busca textual em Postgres.
8. Persistencia: resposta em `messages`, hops/eventos em `agent_calls` e `audit_events`; trilha de delegacao streamada para a UI.

Eventos do stream: `stage`, `matches`, `chunk`, `error`, `metrics`, alem dos eventos de automacao e MCP-EDI.

## Ingestao curada por setor

1. Usuario autenticado abre `/files`.
2. `sector-ingestion-workbench` monta fila local com validacao de tamanho, extensao e setor; admin pode escolher setor a partir de `SectorDefinition` (inclui setores criados dinamicamente).
3. `/api/ingest` (ou `/api/curation/upload`) roteia para `lib/document.ts`; PDF via `pdf-parse v2`, DOCX via `mammoth + turndown`, DOC via `word-extractor`, MD direto. PDFs sem `%PDF` ou sem texto selecionavel sao rejeitados (sem OCR no V1). `.docx` com assinatura OLE2 e tratado como `.doc` renomeado e rejeitado.
4. `/api/classify` retorna pre-classificacao heuristica do tipo de documento; o usuario pode corrigir antes do upload.
5. `lib/curation/upload.ts` grava o `CurationDocument` em Postgres com status `STAGED`, gera profile/knowledge extraction JSON, calcula readiness, aplica respostas-default deterministicas, chama o modelo local para sugerir ate 3 perguntas inferidas (`source="inferred"`, falham silenciosamente) e indexa chunks somente em `rag_<setor>_staging`.
6. Identidade global do arquivo: uploads do mesmo hash em setores diferentes reaproveitam o `CurationDocument` existente e reiniciam o ciclo de revisao em vez de criar duplicata. Promote remove chunks duplicados em outros setores antes de gravar a versao produtiva.
7. Curadoria em `/admin/curation`: filas `Em fila`, `Aprovados`, `Rejeitados` e `Lacunas Operacionais` (perguntas de mapa de processo promovidas). Correlacao automatica contra a colecao produtiva via `DocumentCorrelationRun`; achados criticos/altos bloqueiam aprovacao.
8. Aprovacao: uma decisao `owner` ou `admin` (regra atual relaxada) move para `APPROVED`. Admins podem cobrir aprovacao cross-sector quando `CURATION_ALLOW_SAME_USER_DUAL_APPROVAL=true`.
9. Promote: renderiza artefato fisico em `files/sop/<setor>/<sourceDocumentId>.md` (para SOP) ou `files/curated/<setor>/<documentType>/...` (para nao-SOP), reembeda apenas o artefato promovido em `rag_<setor>`, remove chunks de staging, atualiza `sopPath/promotedAt`, sincroniza `knowledge_capabilities` quando `sensitivity` e `public`/`internal` e registra `document.promoted`.
10. Quando o Ollama esta offline, reprocess/promote responde HTTP 200 com `reindexError`; a resposta salva persiste e o reindex fica adiado. Nao tratar como falha dura.

## Consolidacao cross-sector

`/admin/consolidation` recebe query guiada + setor (`all` ou um) + escopo (`promoted`, `staging`, `both`). Rotas: `POST /api/admin/consolidation/discover|preview|create-draft`.

- `lib/consolidation.ts` recarrega chunks completos por documento, pede ao modelo local uma sintese aterrada (objetivo, contexto, gatilhos, atores, sistemas, entradas, saidas, regras, excecoes, handoffs, perguntas pendentes, passos identificados) e renderiza pre-visualizacao SOP ou DDP.
- Para SOP, se ainda faltam passos operacionais, a API retorna `requiresClarification` em vez de markdown fraco; o curador responde inline e a preview e regerada.
- A curadora pode desmarcar documentos/chunks de proveniencia antes da preview e pre-edita o markdown. `create-draft` envia somente para curacao (`classificationSource="script"`, `authorityLevel="draft"`, status fixado em `IN_REVIEW`).

## Mapa de processos e automacao

`/admin/process-automation-map` consolida processos por setor a partir de procedimentos em Neo4j, documentos curados/staging, candidatos de automacao persistidos, ultimas correlacoes e sinais recentes (`agent.unanswered`, bad feedback). `lib/process-automation-map.ts` calcula readiness de automacao, cobertura documental, confianca, recomendacoes e perguntas de lacuna em nivel de processo.

- Lacunas promovidas a curacao viram `ProcessGapQuestion(status="promoted")` e aparecem na aba `Lacunas Operacionais` em `/admin/curation`.
- Responder uma lacuna em documento ja promovido regenera o artefato, reembeda e remove staging duplicado em outros setores; em documentos nao-promovidos a resposta e aplicada na promocao seguinte.
- A UI separa `Gaps Documentais` (default) de `Candidatos de Automacao`.

## Disparo de automacoes internas (human-in-captcha)

1. `detectHumanCaptchaAutomationIntent()` so dispara em comandos explicitos de execucao.
2. Usuarios em `desenvolvimento` (Forja) disparam direto.
3. Usuarios em `seguranca`/`suporte` recebem `automation.approval_requested` em `AuditEvent`; a proxima mensagem deve confirmar como `sim, motivo: ...` ou cancelar.
4. `lib/integrations/human-captcha.ts` posta no servico externo com bearer interno e `Idempotency-Key` derivado do id da mensagem persistida.
5. O `human-in-captcha` e dono da fila, do worker Playwright, do noVNC, dos scripts e dos arquivos gerados; este app so registra auditoria e exibe `runUrl`/`nextTaskUrl` no stream.
6. Antes de emitir `automation.queued`, o chat enriquece o payload com `automationCandidateId`/`sourceDocumentId` (via lookup em `AutomationCandidate` por `processKey+sector`), sem migrar schema.

Automacoes expostas hoje ao chat de desenvolvimento:

- Chamado Cervello: `POST /integrations/pfrm/cervello/electronic-order-ticket`, processo `problemas-pedido-eletronico`.
- Precos de medicamentos: `POST /integrations/pfrm/automation-scripts/medication-price-survey/run`.
- Indices e moedas: `POST /integrations/pfrm/automation-scripts/coleta-indices-moedas/run`.

`scripts/seed-implemented-automations.ts` (`npm run seed:automations`) registra esses tres fluxos como `AutomationCandidate` de forma idempotente.

## MCP-EDI

Cliente em `lib/integrations/mcp-edi.ts`: handshake `initialize` + `notifications/initialized`, cache de `Mcp-Session-Id` com TTL de 5 min, parser tolerante a JSON e SSE, fallback unico de re-handshake em 404/410. Cobre 5 tools read-only. Detector em `lib/automation/mcp-edi-intent.ts` e deterministico. Config: `MCP_EDI_ENABLED` (default true), `MCP_EDI_URL` (default `http://127.0.0.1:3400/mcp`; em compose sobrescrito para `http://host.docker.internal:3400/mcp`), `MCP_EDI_TIMEOUT_MS` (20000), `MCP_EDI_ALLOWED_SECTORS` (CSV, default `desenvolvimento`).

## Notificacoes, digests e piloto

`instrumentation.ts` inicia rotinas por `setInterval` quando `NOTIFICATIONS_ENABLED != false`.

- `lib/notifications/teams.ts` detecta MessageCard (Incoming Webhook) vs Power Automate Workflows pelo formato da URL e usa payload adequado. URLs `teams.microsoft.com/l/channel/...` sao deep links e retornam `skipped/teams_channel_link_not_webhook` sem chamar `fetch`. Webhooks ausentes retornam `skipped/missing_webhook` em vez de erro.
- `lib/notifications/pendencies.ts` consulta lacunas/correcoes/perguntas sem resposta por owner.
- `daily-digest.ts` e `weekly-digest.ts` geram digests; `weekly:digest` salva em `docs/pmo/weekly-digest/`.
- Pendencias por usuario: badge no shell, pagina `/me/pendencias`, APIs `/api/me/pendencies` e `/api/admin/knowledge-owners` para manter `(topic, sector) -> userEmail`.

Piloto: `lib/pilot/snapshot.ts` + `scripts/pilot-snapshot.ts` (`npm run pilot:snapshot`). Sem `PILOT_USER_EMAILS`, roda em modo pendente. Snapshots em `docs/pmo/kpi-snapshots/`.

Baseline: `npm run measure:kpi-baseline` gera perguntas sinteticas a partir de `seed-docs/`. Modo padrao `engine` (local); modo `http` exige `PFRM_BASELINE_AUTH_COOKIE` para chamar `/api/chat` autenticado.

## Dashboard `/`

`app/page.tsx` renderiza dentro de `SecureAppShell` com `currentPage="dashboard"`. Admin ve hero + 6 KpiCards + grade dos 5 pilares (Operacao, Conhecimento, Automacao, Agentes, Qualidade) + `DashboardHealthStrip` (Postgres/Qdrant/Ollama/RabbitMQ/Neo4j) + `DashboardActivityFeed` + `DashboardStartHere`. Usuario comum ve hero + 4 KpiCards pessoais + grade de "o que voce pode fazer" + 3 pilares informativos + health strip + start-here personalizado. `loadAdminMetrics`/`loadUserMetrics` envolvem cada fetch em `safe()` com timeout de 1500ms; falhas degradam graciosamente sem bloquear SSR.

## Knowledge Graph

`/admin/knowledge-graph` discover documentos de todo setor registrado em `sector_definitions`. `GET /api/graph/documents` usa `listAllSectors()`, retorna metadata de setor/agente e verifica adesao ao grafo por `Document.id`, `sourceDocumentId` e `legacyDocumentId`. `POST /api/graph/extract` valida slugs dinamicos via `isSectorSlug()`.

- A canvas tem dominio selecionavel (Documents, Concepts, Procedures, Systems), filtros locais e lista de refinamento sincronizada.
- Arestas `CO_MENTIONED` (tracejadas) representam associacoes virtuais por co-mencao entre dominios diferentes; nao sao dependencias semanticas validadas.
- `living-docs-tab` (`Documentacao viva`) tem busca-primeiro e agrupamento por dominio.

## Agent Control Center

`/admin/agents`. `AgentConfig` (uma linha por setor, todos os campos nullable) sobrescreve persona/sumario/instrucoes/capacidades/`chatModel`/`topK`/`localConfidenceThreshold`. Protocolos sao editaveis. `lib/agents/effective.ts` mescla overrides sobre defaults com cache de 10s. `syncProtocols` faz insert-only para preservar edicoes apos restart.

## Decisoes inegociaveis

- **Isolamento de setor**: usuario fala somente com o agente do proprio setor. Trafego cross-sector so via RabbitMQ.
- **Ingestao**: sempre grava no setor do usuario autenticado, exceto upload admin com escolha explicita.
- **Gate de sensibilidade**: `confidential` e `restricted` nao atravessam setores; apenas `public`/`internal` promovidos viram `knowledge_capabilities` ou retorno cross-sector.
- **Evidencia local fraca nao bloqueia fanout**: acima do piso minimo de citacao mas abaixo de `CHAT_LOCAL_CONFIDENCE_THRESHOLD`, vira contexto secundario quando outro setor traz score melhor.
- **Auditoria e SQL fazem parte do fluxo principal**, nao sao opcionais.
- **Integracoes externas** usam HTTP interno autenticado em rede Docker compartilhada (bearer + `Idempotency-Key`), sem acesso direto a banco, Redis ou RabbitMQ alheios.
- **App nao e dono da fila de automacao**: o `human-in-captcha` e que possui worker, noVNC, scripts e arquivos gerados.
- **Padrao de mutacao tripla** (Postgres + Qdrant + Neo4j) e o unico aceito para identidade/titulo de documento.
- **Curadoria via staging**: nada vai para `rag_<setor>` sem passar por `rag_<setor>_staging` + `CurationDocument`.

## Dividas tecnicas conhecidas

- Bootstrap do bus acontece sob demanda no primeiro chat, misturando inicializacao com trafego.
- Falta suite E2E cobrindo login, chat, ingestao e auditoria ponta a ponta.
- Falta documentacao operacional profunda para deploy e observabilidade fora do ambiente local.
- Download de modelos Ollama ainda depende de script manual (`scripts/bootstrap-models.ps1`) fora de `npm`.
- `npm run build` default (Turbopack) falha por `next.config.ts` ter `webpack()` sem `turbopack: {}`; fallback validado: `npx cross-env NODE_ENV=production next build --webpack`.
- `npm run lint` total tem 2 erros pre-existentes em `components/admin-kpi-card.tsx` e `components/sector-access-matrix.tsx`; usar ESLint focado em mudancas nao relacionadas.
- `tests/agent-config.test.ts` mantem mismatch `hasOverride` vs `override` que aparece no `npx tsc --noEmit` mas nao quebra o build.

## Referencias cruzadas

- Operacao agente-a-agente, automacoes da Forja e regras de expansao: `docs/interoperabilidade-agentes.md`.
- Rollout de ingestao curada: `docs/plans/ingestao-curada-staging-sop.md`.
- ADRs: `docs/adr/` (ex: `0002-teams-notification-channel.md`).
- Piloto: `docs/pmo/pilot-plan.md`, `docs/pmo/pilot-report.md`, snapshots em `docs/pmo/kpi-snapshots/`, digests em `docs/pmo/weekly-digest/`.
- Grafo: `docs/neo4j-knowledge-graph.md`.
