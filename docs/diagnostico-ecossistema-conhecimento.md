# Diagnóstico — Ecossistema de Conhecimento Setorial via RAG Multiagente

Data original: 2026-05-02
Última revisão de status: 2026-05-20
Autor: análise técnica do estado atual do `pfrm-secure-agents` versus a visão de produto declarada
Escopo: workspace `C:\temp\repo\pfrm-secure-chat`, com foco no componente ativo `pfrm-secure-agents`

> **Aviso importante (revisão 2026-05-20)**
>
> Este documento foi escrito em 2026-05-02 e ficou desatualizado. Entre 2026-05-04 e 2026-05-19 grande parte das "peças apenas planejadas" listadas em §2.2 e dos buracos listados em §3 foram efetivamente implementados. A seção "Atualização 2026-05-20" abaixo registra o que mudou em relação à fotografia original; o restante do documento foi preservado por valor histórico, mas **não deve ser lido como descrição do estado atual sem antes ler essa seção**.

---

## Atualização 2026-05-20 — Correção de status

### Itens da §2.2 que saíram do "planejado" e viraram código

| Item planejado em 2026-05-02 | Estado em 2026-05-20 | Onde |
| --- | --- | --- |
| Curadoria com staging + variantes (portada de `pfrm-chat`) | Implementada e estendida | `lib/curation/*`, `app/admin/curation`, `DocumentStatus` com 8 estados |
| Edição de chunks por administrador | Implementada (sugestão de usuário + fila de revisão) | `ChunkFeedback`, `app/admin/corrections`, `/api/feedback/chunk` |
| Mapeamento explícito de proprietário por tópico | Modelo persistido | `KnowledgeOwner(topic, sector, userEmail)` |
| Workflow de remediação (lacuna → curadoria → correção) | Implementado dentro do app (web) | `ProcessGapQuestion`, `/admin/curation` aba `Lacunas Operacionais`, reindex automático do artefato promovido |
| Migração para backend NestJS | **Continua não iniciada** | `estrategia-migracao-nest.md` (apenas documento) |
| Multicanal (Teams/Telegram/WhatsApp) | **Continua não iniciado** | `MULTICHANNEL-STRATEGY.md` (apenas documento). O classificador admite o tipo `conversa` para ingestão futura, mas conectores externos não existem. |

### Itens da §3 que mudaram de status

- **§3.1 (loop "lacuna → responsável → correção")** — parcialmente fechado **dentro da aplicação web**:
  - `agent.unanswered` continua sendo gravado e agora também alimenta o `ProcessMap` (sinal de baixa cobertura por processo).
  - `bad feedback` ganhou modal com comentário (até 1000 caracteres), persistido em `AuditEvent.payload`.
  - Sugestão de correção por chunk: usuário clica na citação, propõe novo texto, vai para fila `chunk_feedbacks` (status `PENDING`/`APPROVED`/`REJECTED`); revisor admin ou setorial aprova/aplica em `/admin/corrections`.
  - `ProcessGapQuestion` promovida para curadoria aparece em `/admin/curation` como "Lacunas Operacionais"; resposta do curador é gravada na última `DocumentReview` e reprocessa o documento promovido (reindex Qdrant + regrava arquivo curado físico).
  - **O que ainda falta**: notificação para fora da aplicação (e-mail/Teams/WhatsApp) ao dono do conhecimento. O `KnowledgeOwner` existe como modelo, mas não há rotina que dispare aviso quando uma lacuna for atribuível ao tópico daquele dono. A lacuna ainda só é vista por quem abre o `/admin/curation`.

- **§3.2 (ingestão direta sem revisão)** — corrigida. Toda ingestão vai para `rag_<setor>_staging`; entra na fila de curadoria; promoção exige aprovação (admin ou owner) e correlação resolvida; chunks só vão para a coleção produtiva via promoção.

- **§3.3 (granularidade de responsabilidade)** — parcialmente corrigida:
  - Modelo `ProcessMap` (com `name`, `fingerprint`, `automationReadinessScore`, `documentationCoverageScore`, `confidenceScore`, `processSignals`, `systemNames`, `documentRefs`, `graphEvidence`, `vectorEvidence`) introduzido em 2026-05-09.
  - `ProcessGapQuestion` vincula lacuna a `processMap` e opcionalmente a `targetCurationDocument`.
  - `KnowledgeOwner(topic, sector, userEmail)` modelado e seedado para piloto.
  - **Limitação remanescente**: o nó "Pessoa Dona" ainda não é cidadão de primeira classe dentro do grafo de processo; o pareamento ProcessMap → KnowledgeOwner não está formalizado como FK e o roteamento de gap continua agregando por setor, não por pessoa. Para mapear processo para nome, ainda há uma camada de inferência humana via interface admin.

- **§3.4 (reranker e score mínimo)** — parcialmente endereçado. O retrieval ganhou:
  - `MIN_RELEVANT_SCORE=0.30` como piso para citação utilizável.
  - `CHAT_LOCAL_CONFIDENCE_THRESHOLD=0.50` (configurável) como gatilho para fan-out cross-sector quando o melhor chunk local fica abaixo do limiar.
  - Atribuição explícita do agente delegado na resposta final (`Segundo o agente Helpdesk (setor suporte)...`).
  - **O que ainda falta**: cross-encoder reranker (ex. `bge-reranker-v2-m3`) por cima do retrieval cosine — continua ausente; ranking permanece similaridade pura com gating por threshold.

- **§3.5 (citações rastreáveis até correção)** — corrigido. A citação no chat tem ação "corrigir trecho" que abre `chunk_feedbacks` (vide §3.1) e cai em `/admin/corrections`. Quando aprovado, o conteúdo do chunk é regravado e re-embedado.

- **§3.6 (embeddings versionados)** — não corrigido. `bge-m3` continua monolítico; troca de modelo segue exigindo reembed integral.

- **§3.7 (bootstrap operacional misturado com aplicação)** — não corrigido. `ensureBusBootstrapped()` continua disparado na primeira chamada `POST /api/chat`. Mitigado por `instrumentation.ts`, mas a separação como job de inicialização explícito ainda não existe.

- **§3.8 (fallback local mascara queda de bus)** — não corrigido. O fallback local permanece. O evento `delegation.local_fallback` é gravado, mas não há alerta automático que dispare quando a taxa cruza um limiar; só aparece se alguém olhar `/admin/audit`.

- **§3.9 (suite E2E)** — não corrigido. A suite Vitest cobre rotas, protocolos, classificação, curadoria, consolidação, ingestão, lacunas e perfis (≈ 100 testes em ~29 arquivos), mas continua sem fluxo E2E ponta a ponta (login → chat → delegação → resposta → feedback → correção aplicada).

- **§3.10 (multicanal)** — não corrigido. Web continua como canal único.

- **§3.11 (sensibilidade na ingestão)** — corrigido. Curadoria coleta `sensitivity` (`public`/`internal`/`confidential`/`restricted`), default `public` quando ausente. Sensibilidade passa para o payload Qdrant, restringe compartilhamento cross-sector via `KnowledgeCapability`, e aparece em `/admin/content` como badge.

- **§3.12 (verdade declarada/`supersedes`/`effective_from`)** — parcialmente corrigido. Os campos `effectiveFrom` e `supersedes` existem em `CurationDocument`. A política de "este documento aposenta aquele" tem suporte de dado, mas não há fluxo de UI dedicado para declarar o supersede ainda; também não há aviso ao agente para preferir a versão vigente quando duas estão no índice — a deduplicação por `sourceDocumentId` resolve o caso comum, mas não cobre revisões com identidade diferente.

- **§3.13 (métricas operacionais)** — parcialmente corrigido. O dashboard em `/` (a partir de 2026-05-19) tem KPI cards (curadoria pendente, gaps abertos, feedback 24h, mensagens 24h, processos mapeados, candidatos a automação), tira de saúde de serviços, feed de atividade. O `kpi-baseline.md` define metas operacionais, mas ainda não há painel comparando KPI atual vs meta nem alerta automático por desvio.

### Itens construídos que não estavam nem em §2.2 nem em §3 (escopo expandido após 2026-05-02)

- **Mapa de Processos** (`/admin/process-automation-map`, 2026-05-09): consolida `Procedure` do Neo4j + documentos curados/staging + `AutomationCandidate` persistidos + última `DocumentCorrelationRun` + sinais de feedback negativo / `agent.unanswered` em uma fingerprint estável de processo, com automation readiness, documentation coverage, confidence, recomendações e geração de `ProcessGapQuestion` por lacuna.
- **Consolidação Cross-Sector** (`/admin/consolidation`, 2026-05-06 e refinada em 2026-05-11): busca guiada por query + setor + escopo (`promoted`/`staging`/`both`), gera prévias SOP e DDP, exige seleção/desseleção explícita de proveniência por documento e por chunk antes de gerar, e envia o draft revisado para `staging` (não promove direto). DDP virou tipo de primeira classe.
- **Grafo de Conhecimento Bidirecional** (`/admin/knowledge-graph`, refinado em 2026-05-08/09/12): 5 entidades persistidas (Concept, Procedure, System, Regulation, Person), nós `RagChunk` ligando Qdrant↔Neo4j (`HAS_RAG_CHUNK`), `evidenceChunkIds` em arestas documento-entidade quando a entidade é citada no texto do chunk, arestas virtuais `CO_MENTIONED` computadas em tempo real entre entidades co-citadas. Aba "Documentação Viva" com busca cross-domain.
- **Reclassificação de Pessoas** (`/admin/people-reclassify`, 2026-05-18): converte ocorrências de nomes em entidades semânticas (Conceito/Processo/Sistema/Regulamentação), regrava o conteúdo do chunk, regenera embedding e troca arestas no grafo. Opcionalmente remove o nó Person quando órfão.
- **Agent Control Center** (`/admin/agents`, 2026-05-08): `AgentConfig` por setor permite override de `displayName`, `summary`, `instructions`, `capabilities`, `chatModel`, `topK`, `localConfidenceThreshold`. `Protocol` editável por UI (template, max tokens, enabled). Bootstrap insert-only para não sobrescrever edições.
- **Setores Dinâmicos** (`SectorDefinition` + `SectorAccessRule`, 2026-05-12): admins podem criar setores além dos 4 nativos (`desenvolvimento`, `seguranca`, `suporte`, `desktop`), com coleções Qdrant próprias, persona de agente e regras de acesso outbound/inbound (`public`/`full`/`denied`) e palavras-chave de roteamento.
- **Política de "Não Sei" com Fan-out**: quando o melhor chunk local fica abaixo do limiar de confiança, o agente consulta todos os outros setores com protocolo habilitado e prefere evidência delegada mais forte; é a implementação parcial de §4.2.
- **Modos de Recuperação no Chat** (2026-05-08): toggles independentes `RAG` e `Grafo`. `RAG ON + Grafo ON` é o caminho default; `RAG OFF + Grafo ON` usa Neo4j para selecionar documentos por entidades e lê o conteúdo de Postgres; `RAG OFF + Grafo OFF` faz busca textual SQL em documentos promovidos.
- **Aprovação Cross-Agent de Automações** (2026-05-04/05-15): pedidos vindos de setores não-Forja para `human-in-captcha` exigem confirmação humana posterior com motivo curto, registrada em `automation.approval_requested`.
- **Inferência e Defaults na Curadoria** (2026-05-06): respostas-padrão deterministas + perguntas inferidas pelo modelo local (até 3, marcadas como `source="inferred"`); perguntas template viraram opcionais; uma única aprovação (owner OR admin) basta para liberar promote, dispensando os dois carimbos.

### Síntese da revisão

O diagnóstico original tratava o sistema como **rico em sinal, pobre em loop**. Em 2026-05-20, o sistema é **rico em sinal, rico em loop dentro do app web, e ainda pobre em "loop que sai do app"**. O conjunto de peças necessárias para fechar lacuna → dono → correção dentro do navegador foi construído — falta o degrau final que leva o sinal até onde a pessoa já está (e-mail/Teams), uma rotina explícita de notificação, e a prova externa de que o sistema realmente roda em piloto real com usuários que não são os próprios desenvolvedores.

O leitor que quer entender o estado atual deve usar **esta seção** como referência e tratar §2 a §7 do diagnóstico original como inventário do que tinha sido construído até 2026-05-02 — útil como linha de base histórica, não como retrato atual.

---

## (Conteúdo original a partir daqui — 2026-05-02)

---

## 1. Visão declarada pelo patrocinador

O projeto não pretende ser um "chat com IA". Ele pretende atacar diretamente o que o patrocinador identifica como o **maior problema das companhias**: a documentação de processos críticos vive na cabeça de poucos colaboradores-chave. Quando essa pessoa sai, fica de licença ou está ocupada, o processo trava ou é executado de forma errada.

O produto-alvo, declarado pelo usuário, tem três camadas:

1. **Recuperação assistida do conhecimento existente** — chat RAG multissetorial que responde a partir de bases vetorizadas próprias de cada setor.
2. **Conexão com outros agentes e fontes externas** — agentes especializados conversam entre si quando a pergunta atravessa domínios; integrações executam ações concretas em sistemas internos.
3. **Loop de correção e descoberta de lacunas** — toda pergunta sem resposta adequada, faltante ou errada vira sinal. O sinal é roteado para o **responsável humano daquele conhecimento** (setor/processo) para corrigir a fonte ou confirmar a versão correta.

A meta de longo prazo é um **ecossistema** que aprende com cada lacuna e converge para uma base institucional viva, não um sistema que apenas consulta documentos.

---

## 2. O que já está construído — leitura honesta do código

### 2.1 Componentes ativos

| Camada                              | Estado     | Onde                                                                                          |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| Chat setorial autenticado           | Pronto     | `app/api/chat/route.ts`, `components/secure-chat-workbench.tsx`                                |
| Isolamento por setor                | Pronto     | `lib/qdrant.ts` (coleção por setor), `auth.ts` propaga `sector` no JWT                         |
| Agente-a-agente via RabbitMQ        | Pronto     | `lib/bus/*`, `lib/agents/base-agent.ts`                                                        |
| Protocolos de delegação             | Pronto     | `lib/agents/protocols.ts`, `lib/agents/router.ts`, `lib/agents/classifier.ts`                  |
| Auditoria persistida                | Pronto     | `prisma/schema.prisma` (`AuditEvent`, `AgentCall`), consumer `lib/bus/audit-consumer.ts`        |
| Ingestão setorial                   | Pronto     | `app/api/ingest/route.ts`, `lib/document.ts`, `.md / .docx / .doc / .pdf`                      |
| Feedback (👍/👎) por mensagem       | Pronto     | `app/api/messages/[messageId]/feedback/route.ts`, `app/admin/feedback/page.tsx`                |
| Visualização de chunks (Qdrant)     | Pronto     | `app/admin/content/page.tsx`, `app/api/admin/chunks/route.ts`                                  |
| Disparo de automações externas      | Pronto     | `lib/integrations/human-captcha.ts` (Cervello, preços de medicamentos, índices/moedas)         |
| Trilha de delegação na UI           | Pronto     | `delegation_start` / `delegation_result` events                                                |
| Fallback local quando bus atrasa    | Pronto     | `runSectorAgent()` em `lib/agents/base-agent.ts`                                                |
| Evento `agent.unanswered`           | Pronto     | `app/api/chat/route.ts` linhas 586-599                                                         |
| Tela de feedback com trilha         | Pronto     | `app/admin/feedback/page.tsx` (mostra mensagens, hops e auditoria)                             |

### 2.2 Componentes apenas planejados (existem como documento, não como código)

| Item                                                  | Documento                                       | Código equivalente |
| ----------------------------------------------------- | ----------------------------------------------- | ------------------ |
| Multicanal (Teams/Telegram/WhatsApp)                  | `MULTICHANNEL-STRATEGY.md`                       | Não iniciado       |
| Migração para backend NestJS                          | `estrategia-migracao-nest.md`                    | Não iniciado       |
| Curadoria com staging + variantes (existe em `pfrm-chat`) | --                                          | Não portado        |
| Edição de chunks por administrador                    | --                                              | Apenas leitura     |
| Mapeamento explícito de proprietário por tópico       | --                                              | Não modelado       |
| Workflow de remediação (lacuna → dono → correção)     | --                                              | Não existe         |

### 2.3 Decisões técnicas que merecem registro permanente

- **Invariante central preservada:** o usuário só fala com o agente do próprio setor. Tráfego cross-sector ocorre apenas via barramento e protocolos.
- **Auditoria não é add-on:** é parte do caminho crítico. Toda pergunta gera `user.question`; toda resposta sem citações dispara `agent.unanswered`; todo feedback é persistido com `traceId` e setor.
- **Aprovação cross-agent para automações:** setores não-Forja precisam confirmar com motivo curto antes de qualquer execução em sistemas externos. Esse desenho está correto.
- **Idempotência:** chamadas ao `human-in-captcha` carregam `Idempotency-Key` derivada do `messageId`. Bom.
- **Fallback local quando bus não responde:** controlado, registrado em `delegation.local_fallback`, mas tem efeito colateral — ver §3.

---

## 3. O que falta para chegar à visão declarada

Esta seção lista os **buracos concretos** entre o que o código entrega hoje e o produto-alvo.

### 3.1 Não há loop "lacuna → responsável → correção"

A peça central da visão está faltando. Hoje:

- `agent.unanswered` é gravado, mas **não há fila, dashboard ou notificação** que entregue isso a um humano responsável.
- `user.feedback = bad` é capturado, mas a tela `/admin/feedback` é **apenas leitura**. Não há atribuição, status, prazo, nem ação corretiva associada.
- Não existe modelo de dados para "responsável pelo conhecimento X". O `responsibleArea` que existe em `pfrm-chat` (no upload curado) **não foi portado** para `pfrm-secure-agents`.

**O que isso significa na prática:** o sistema sabe quando errou ou não soube, mas o sinal morre num log. O ecossistema declarado não existe sem fechar esse loop.

### 3.2 Ingestão é direta, sem revisão humana

- Em `pfrm-chat`, o time já validou um fluxo de **staging → entrevista do agente → variantes (`conservative`/`rewrite`) → revisor seleciona → publica**. Esse fluxo **não existe** em `pfrm-secure-agents`.
- Isso significa que documentos vão direto para a coleção que serve respostas reais a usuários autenticados. Qualquer erro de origem entra no índice sem checagem.

### 3.3 Granularidade de responsabilidade está errada

- O modelo atual tem **3 setores**. A vida real tem **dezenas de processos por setor**, cada um com seu dono.
- Sem mapeamento `processo → dono`, não dá para rotear "essa lacuna deveria ser respondida pelo João do faturamento" — só dá para dizer "isso é do setor de suporte", o que joga o problema para um chefe que não tem o contexto.

### 3.4 Não há ranking de qualidade de resposta nem rerank

- O retrieval é cosine-similarity puro sobre `bge-m3`. Sem reranker (ex.: `bge-reranker-v2-m3` ou cross-encoder local), a probabilidade de ranquear chunks irrelevantes acima de relevantes em corpus pequeno é alta.
- Sem score mínimo configurado no prompt, o agente pode citar chunks fracos como se fossem fortes.

### 3.5 Citações não são rastreáveis até a correção

- A UI mostra a citação, mas **não há botão "esse trecho está errado"** ligando o feedback à origem (chunk/documento/seção). Sem isso, mesmo um usuário motivado a ajudar não consegue.

### 3.6 Embeddings e modelos são monolíticos

- Trocar `bge-m3` exige re-embeddar **toda a base**. Não há versionamento de embedding model por chunk; quando o time decidir migrar, não dá para fazer side-by-side.

### 3.7 Bootstrap operacional misturado com tráfego de aplicação

- `ensureBusBootstrapped()` roda no primeiro `POST /api/chat`. Em ambiente de produção real, isso é débito — bootstrap deve ser separado, idealmente um job de inicialização ou um endpoint `/internal/bootstrap` chamado pelo deploy.

### 3.8 Fallback local mascara falha de bus

- Quando o RabbitMQ não responde a tempo, o agente origem **executa o RPC localmente** chamando `answerAgentInternally()`. O resultado fica correto para o usuário, mas:
  - A resposta consultou a base do **setor destino** sem passar pelo agente do setor destino.
  - O evento `delegation.local_fallback` é registrado, mas se ninguém olha esse evento, **uma queda crônica do bus passa silenciosa**.
  - O isolamento de setor não é violado em termos de dados (a coleção certa é consultada), mas a promessa arquitetural ("agente destino responde") é.

### 3.9 Não há suite E2E

- `npm test` cobre roteamento, protocolos, ingestão e upload. Não há teste de ponta a ponta cobrindo login → chat → delegação → resposta → feedback → admin. Em produto que vende confiança, isso é risco crítico.

### 3.10 Não há canais externos

- Multicanal está apenas em estratégia. Para o ecossistema declarado, **canal único web é gargalo de adoção**: as pessoas vão consultar Forja/Sentinela/Helpdesk pelo Teams ou WhatsApp, não abrindo outra aba.

### 3.11 Não há classificação de sensibilidade na ingestão

- Qualquer `.pdf` entra. Em uma farmacêutica, parte da documentação contém PII de pacientes, dados regulatórios (ANVISA), informações comerciais sensíveis. Sem rótulo de classificação na ingestão, a base mistura tudo.

### 3.12 Não há "verdade declarada"

- Quando dois documentos contradizem, não há como dizer "este aqui é o que vale a partir de tal data". Sem `supersedes` / `effective_from` no payload, o agente pode citar a versão antiga com confiança.

### 3.13 Métricas operacionais não existem como KPI

- Os dados estão no Postgres, mas não há painel de:
  - Taxa de respostas com 0 citações.
  - Distribuição de feedback por setor / por dia.
  - Tempo médio entre `bad feedback` e correção da fonte.
  - Top-10 perguntas sem resposta.
  - Taxa de delegação por setor.
- Sem isso, ninguém defende o ROI nem prioriza correção.

---

## 4. Insights e revelações sobre esse tipo de implementação

### 4.1 O ativo real não é o chat — é o backlog de lacunas

A visão correta inverte o entendimento usual: o **valor não está nas respostas certas, mas nas perguntas que o sistema falha em responder bem.** Cada `agent.unanswered` é um termômetro de onde a documentação está fraca. Cada `bad feedback` é um termômetro de onde o conhecimento está errado ou desatualizado.

**Implicação:** o que precisa ser melhor projetado não é o RAG — é o pipeline pós-resposta ruim. Esse é o "produto" que diferencia um chat-de-RH genérico de um sistema de descoberta institucional.

### 4.2 Adoção depende de baixíssima taxa de alucinação inicial

LLM que erra uma vez perde o usuário por meses. Em vez de tentar responder tudo, o sistema deve **abraçar o "não sei"**:

- Threshold mínimo de score por chunk para responder.
- Quando abaixo do threshold, agente retorna `"Não tenho documentação suficiente para responder com segurança. Registrei essa pergunta como lacuna e o responsável do setor X foi notificado."`
- Isso transforma erro em valor: o usuário não fica frustrado, e o backlog cresce.

Hoje o código permite resposta com 0 citações (existe `agent.unanswered`, mas o agente ainda gera texto). Isso precisa virar política: **sem citação suficiente = recusa explícita + abertura de lacuna**.

### 4.3 Resistência cultural é o maior risco — não o técnico

Quem detém conhecimento tácito tem **incentivo subliminar para não documentar**: a indispensabilidade é parte do poder informal. O sistema, quando bem-sucedido, **ameaça esse poder.**

Sintomas a observar nos próximos 90 dias:

- Pessoa-chave que "não tem tempo agora" para validar correções.
- Documentação enviada propositalmente vaga, exigindo a pessoa para interpretar.
- Reclamações de que "o bot tá respondendo errado" sem indicar onde está errado, deslegitimando a ferramenta.
- Demanda recorrente de "melhorar a IA" em vez de "melhorar a fonte".

**Mitigação:** o programa precisa ter patrocínio executivo explícito, reconhecer **publicamente** quem corrigiu mais lacunas, e medir tempo de correção como KPI de gestão (não de TI).

### 4.4 O sistema precisa de uma "constituição" antes de muitos agentes

Adicionar agentes é tentador. Cada agente novo aumenta combinatoriamente os pares de delegação. Antes de chegar a 5+ setores, o time precisa congelar:

- Como se decide que pergunta é de quem (classificação de domínio).
- Como se resolve conflito quando dois setores reivindicam autoridade.
- Como se aposenta um agente sem perder histórico.
- Como se aprovam novas automações da Forja sem virar shadow IT.

Essa "constituição" é o que `docs/interoperabilidade-agentes.md` começa a esboçar, mas precisa ganhar status de norma assinada.

### 4.5 Custo do erro escala com adoção

Imagine 200 usuários, 10 perguntas/dia, 95% de acerto: ainda assim **100 respostas erradas/dia**. Em ambiente farmacêutico, uma resposta errada sobre processo regulatório, ANVISA, conduta de sala limpa ou interação medicamentosa não é ruído — é incidente.

**Implicação:** existe uma classe de perguntas onde o sistema **nunca deve responder** mesmo que tenha contexto. Detectores de tópico sensível precisam virar um filtro pré-resposta, com encaminhamento humano obrigatório.

### 4.6 O barramento e a auditoria são vantagem competitiva, não overhead

Times tendem a olhar RabbitMQ e Postgres como custo. Aqui, eles são o que faz o produto **defensável**:

- Auditoria reproduzível por `traceId` significa que toda decisão é audithistória — é o que aprovação interna de compliance vai pedir.
- Barramento desacoplado significa que adicionar um quarto agente (financeiro? jurídico?) não toca os três existentes.

Essa narrativa precisa ser explícita para a liderança, senão o time vai sofrer pressão por "simplificar" e perder essa garantia.

### 4.7 Integração com `human-in-captcha` é um vetor de privilégio

Hoje, qualquer mensagem do setor `desenvolvimento` que case com os gatilhos abre chamado em sistema externo (Cervello). Isso é **execução autenticada via linguagem natural** — categoria nova de risco operacional.

Mitigações sugeridas:

- Lista de quem pode disparar (não basta ser do setor — precisa ser perfil "operador").
- Limite de execuções por usuário/dia.
- Registro visual permanente no chat com **link para revogar** durante uma janela curta.
- Revisão periódica dos disparos (já tem evento auditado, falta o painel).

### 4.8 Fontes externas como cidadãos de primeira classe

A visão fala de "agentes com suas próprias fontes de dados e integrações". Hoje o RAG só lê documentos. Mas o conhecimento real vive em:

- ServiceNow / Cervello (chamados resolvidos)
- Confluence / SharePoint (procedimentos)
- E-mails arquivados de operação
- Wiki interna
- Bases de exceções e exceções de exceções

**Implicação:** `seed-docs/` é um arranque, não a estratégia. Em algum momento próximo, o ingestor precisa virar **conector**, com sincronização agendada e respeito ao ACL da fonte.

### 4.9 Um chat que "lembra" muda o jogo

Hoje cada pergunta é independente. Implementar **memória por usuário** (preferências, papel, projetos ativos) e **memória por conversa** (contexto vivo) é o que separa "chatbot" de "colega digital".

Isso já existe parcialmente — `Conversation` persiste mensagens — mas não é usado como contexto. Próximo nível: o agente recupera as últimas N mensagens da mesma conversa e/ou perfil do usuário antes de buildar o prompt.

### 4.10 Versionamento de conhecimento é um problema de tempo, não de espaço

O instinto inicial é "guardar todas as versões". O instinto correto é **carimbar a versão vigente e aposentar a anterior**. Sem isso, em 18 meses a base estará 30% obsoleta e ninguém saberá onde.

---

## 5. Resistências e impedimentos provavelmente subestimados

| Resistência                                                      | Origem provável                              | Sinal de alerta                                                              |
| ---------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| "Mas e a LGPD?"                                                  | Compliance / Jurídico                        | Vetada por falta de DPIA. Tem que entrar antes da expansão de canais.        |
| "A IA vai me substituir"                                         | Especialistas detentores de conhecimento     | Documentação enviada vaga, reclamações sem evidência.                        |
| "Isso é mais um sistema para manter"                             | TI / Sustentação                             | Pressão para encerrar projeto se MTTR não estiver definido.                  |
| "Por que não usamos ChatGPT/Copilot?"                            | Comitê de tecnologia / liderança             | Falta narrativa clara sobre soberania de dado e isolamento setorial.         |
| "Quem responde se a IA der instrução errada?"                    | Jurídico / Diretoria                         | Falta política de uso e disclaimer assinado pelo usuário.                    |
| "Não vou ficar corrigindo bot"                                   | Especialistas de domínio                     | Backlog de lacunas cresce sem ação por semanas.                              |
| "Isso só funciona se todo mundo usar"                            | Liderança operacional                        | Adoção concentrada em early adopters; resto resiste.                         |
| "A documentação que temos é uma vergonha"                        | Setores com baixa maturidade documental       | Recusa em ingerir até "limpar" — projeto trava em "vamos primeiro organizar". |

**Padrão comum:** a maioria das resistências não é técnica. É política, jurídica e psicológica. Tratar essas três camadas como prioridade igual à camada técnica é o que decide se o produto vinga ou vira shelfware.

---

## 6. Roadmap mínimo para fechar o loop declarado

Sequência recomendada (cada item pressupõe os anteriores):

1. **Política de "não sei":** threshold mínimo de score; recusa explícita; toda recusa abre lacuna.
2. **Modelagem de dono por tópico:** estender `Protocol` ou criar tabela `KnowledgeOwner(topic, sector, userEmail)`.
3. **Painel de lacunas:** lista de `agent.unanswered` + `bad feedback`, com atribuição, status e prazo. Notificação ao dono.
4. **Botão "esse trecho está errado"** na citação, ligando ao chunk/documento; abre incidente de conhecimento.
5. **Curadoria com staging:** portar do `pfrm-chat`. Ingestão direta vira exceção, não regra.
6. **Reranker** para reduzir false-positives no retrieval.
7. **Métricas e KPIs** (§3.13) num painel acionável.
8. **Memória por usuário/conversa** no prompt.
9. **Conectores** para fontes externas autoritativas.
10. **Multicanal** (Teams/Telegram/WhatsApp) — só após o loop estar maduro na web.

---

## 7. Sumário executivo em uma página

- O **chat funciona** e o **isolamento por setor é sólido**.
- A **delegação entre agentes funciona** e está bem auditada.
- O sistema **detecta** quando errou ou não soube, mas **não fecha o loop** que é a essência da visão.
- A **resistência cultural e o risco regulatório** são maiores que o risco técnico, e ainda não estão endereçados.
- Os próximos 90 dias deveriam priorizar **fechamento do loop** (lacuna → dono → correção), não novos canais nem novos agentes.
- O produto tem **vantagem real defensável** (auditoria, isolamento, soberania de dado local), e isso precisa virar narrativa explícita para resistir ao "por que não usamos ChatGPT?".

A continuidade está descrita em `docs/pmo/` com artefatos práticos para gestão.
