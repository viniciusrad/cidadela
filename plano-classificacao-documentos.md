# Plano refinado - Classificacao, ingestao util e descoberta de automacoes

Data da revisao original: 2026-05-05
Ultima revisao de status: 2026-05-20
Alvo: `pfrm-secure-agents`

> **Status de execucao (2026-05-20)**
>
> Este plano foi majoritariamente executado entre 2026-05-05 e 2026-05-19. Resumo por fase (vide secao 13):
>
> - **Fase 0 (alinhamento)**: concluida. Decisoes da secao 14 fechadas em 2026-05-05.
> - **Fase 1 (fundacao de tipos)**: concluida em 2026-05-05. `lib/document-types.ts` criado (hoje com 11 tipos: `sop`, `ddp`, `norma`, `ata`, `doc_tecnica`, `faq`, `comunicado`, `relatorio`, `contrato`, `conversa`, `generico`), migration aplicada, payload Qdrant carrega `document_type` e `authority_level`, `AutomationCandidate` modelado e persistido.
> - **Fase 2 (classificacao pre-upload)**: concluida em 2026-05-05. `lib/document-classifier.ts` heuristico + `POST /api/classify` + UI de ingestao mostram sugestao corrigivel antes do envio.
> - **Fase 3 (curadoria por tipo)**: concluida. `lib/curation/profiles.ts` aplica perfis por tipo; perguntas template viraram opcionais em 2026-05-06; uma unica aprovacao (owner OU admin) basta para liberar promote. Readiness por tipo vive em `lib/curation/profiles.ts` + `lib/sop-readiness.ts`.
> - **Fase 4 (renderizadores e promote por tipo)**: concluida. `lib/curation/renderers.ts` cobre todos os tipos; promote indexa artefato curado correto; `source_type` deixa de ser sempre `sop`; capabilities consideram tipo.
> - **Fase 5 (extracao de conhecimento e automacoes)**: parcial. `knowledgeExtraction` e persistido em `CurationDocument` como JSON; candidatos de automacao sao exibidos e podem ser indicados manualmente; o script `scripts/extract-automation-candidates.ts --dry-run` ainda nao foi criado.
> - **Fase 6 (backlog de automacoes)**: parcial. Tabela `AutomationCandidate` em uso, listagem em `/admin/process-automation-map` aba `Candidatos de Automação`, status transitavel por admin (geral ou setorial). O "export para especificacao de script" e a tela de detalhe por candidato com contrato de execucao ainda nao foram entregues como UI dedicada.
> - **Fase 7 (reclassificacao do corpus)**: parcial. Nao existe `scripts/reclassify-corpus.ts`. Existe, em vez disso, a tela `/admin/people-reclassify` (2026-05-18) que cobre o caso mais critico observado no corpus (referencias a pessoas que deveriam ser entidades semanticas), mas a reclassificacao em massa de `documentType` segue manual.
>
> Observacoes complementares (nao previstas no plano original):
> - `SOP` continua sendo um tipo entre varios, alinhado a premissa refinada da secao 3.
> - Foi adicionado tipo `conversa` para futura ingestao de Teams/WhatsApp (conectores ainda nao existem).
> - Tipo `ddp` (Documento Descritivo de Processo) virou cidadao de primeira classe junto com SOP no fluxo de consolidacao `/admin/consolidation`.
> - A curadoria ganhou correlacao automatica contra a base produtiva (`DocumentCorrelationRun`), perguntas inferidas pelo modelo local marcadas como `source="inferred"` e perguntas oriundas de mapas de processo marcadas como `source="process_gap"`.
> - O fluxo "lacuna operacional -> curadoria -> reprocesso do documento promovido -> reindex Qdrant" foi entregue em 2026-05-11 e fecha o ciclo de melhoria continua do artefato curado.
>
> Para descricao detalhada das mudancas, ver `memory.md` e o registro atualizado em `docs/diagnostico-ecossistema-conhecimento.md`. O restante deste arquivo foi preservado como design-rationale historico.

## 1. Objetivo

A ingestao nao deve apenas colocar documentos no RAG. Ela precisa transformar
arquivos heterogeneos em conhecimento confiavel, consultavel, versionado e
acionavel.

O objetivo deste plano e evoluir a ingestao curada existente para:

1. Classificar corretamente o tipo e a finalidade de cada documento.
2. Aplicar curadoria adequada ao tipo, sem forcar tudo a virar SOP.
3. Preservar autoridade, vigencia, sensibilidade, dono e setor.
4. Extrair sinais de processo, decisao, regra, excecao, tarefa e sistema.
5. Mapear oportunidades de automacao total, parcial ou assistida.
6. Permitir que scripts personalizados sejam propostos a partir do conhecimento
   ingerido, mas apenas depois de revisao humana e aprovacao explicita.

## 2. Contexto atual confirmado

O projeto ja possui uma base importante:

- Upload autenticado por setor em `/api/ingest`.
- Staging Qdrant por setor: `rag_<setor>_staging`.
- Producao Qdrant por setor: `rag_<setor>`.
- Persistencia em `CurationDocument`, `DocumentReview`, `DocumentApproval`,
  `DocumentCorrelationRun`, `KnowledgeOwner` e `KnowledgeCapability`.
- Curadoria em `/admin/curation`.
- Correlacao contra a base produtiva antes de aprovar.
- Sensibilidade `public`, `internal`, `confidential`, `restricted`, com default
  efetivo `public` quando ausente.
- Promote atual gera SOP Markdown fisico em `files/sop/<setor>/...` e indexa
  o SOP, nao o documento bruto.
- Descoberta intersetorial usa apenas documentos promovidos e compartilhaveis.
- Correcoes de chunks ja podem ser sugeridas por usuarios e revisadas.

O ponto fraco atual: a curadoria ainda trata todo documento como se fosse SOP.
Isso e ruim para atas, comunicados, documentacao tecnica, politicas, FAQs,
relatorios, evidencias e materiais de referencia.

## 3. Mudanca de premissa

Premissa antiga:

> Todo documento produtivo precisa virar SOP.

Premissa refinada:

> Todo documento produtivo precisa virar um artefato curado adequado ao seu
> tipo. SOP e obrigatorio apenas quando o documento descreve execucao
> operacional repetivel. Outros tipos devem manter sua forma util, com resumo,
> metadados, autoridade, vigencia e extracoes estruturadas.

Consequencias:

- SOP continua existindo para procedimentos e rotinas.
- Norma/politica vira referencia normativa curada, nao passo a passo artificial.
- Ata vira registro de decisoes, acoes, responsaveis e prazos.
- Documento tecnico vira referencia tecnica com contratos, dependencias e
  exemplos.
- FAQ vira pares pergunta-resposta.
- Comunicado vira informacao temporal com publico-alvo e validade.
- Evidencia/relatorio vira insumo rastreavel, normalmente sem promover como
  fonte normativa isolada.

## 4. Principios de produto

1. Humano e a fonte da verdade. A IA sugere classificacao, perguntas, gaps e
   automacoes; o curador confirma.
2. Nao responder sem autoridade. Conteudo sem dono, vigencia ou confianca deve
   ficar em revisao ou gerar lacuna.
3. Nao transformar documento em algo que ele nao e. Curadoria deve aumentar
   utilidade, nao reescrever o historico.
4. Automacao nasce como oportunidade, nao como execucao. Script so entra no
   sistema depois de desenho, revisao, aprovacao e teste.
5. O setor autenticado continua sendo a fronteira de seguranca. Ingestao em
   setor diferente so para admin.
6. Sensibilidade controla compartilhamento. `confidential` e `restricted` nao
   cruzam setores.
7. Cada resposta deve ser rastreavel ate documento, secao, versao e decisao de
   curadoria.

## 5. Tipos documentais propostos

| Tipo | Quando usar | Curadoria principal | Artefato promovido |
| --- | --- | --- | --- |
| `sop` | Procedimento repetivel, checklist, rotina operacional | gatilho, executor, aprovador, passos, entradas, saidas, excecoes | SOP estruturado |
| `norma` | Politica, regra corporativa, regulatorio, compliance | autoridade, abrangencia, obrigacoes, sancoes, excecoes, vigencia | referencia normativa curada |
| `ata` | Reuniao, comite, war room, post-mortem | data, participantes, decisoes, acoes, responsaveis, prazos | registro de decisoes/acoes |
| `doc_tecnica` | Arquitetura, API, integracao, deploy, troubleshooting tecnico | versao, sistemas, contratos, dependencias, exemplos, riscos | referencia tecnica curada |
| `faq` | Perguntas e respostas, base de atendimento | pares Q/A, escopo, publico, links para fontes autoritativas | FAQ curada |
| `comunicado` | Aviso, mudanca temporaria, janela, orientacao pontual | validade, publico-alvo, impacto, data de expiracao | comunicado temporal curado |
| `relatorio` | Diagnostico, analise, auditoria, indicador, evidencia | periodo, metodologia, achados, recomendacoes, limitacoes | relatorio rastreavel |
| `contrato` | SLA, termo, acordo operacional ou tecnico | partes, obrigacoes, prazos, penalidades, versao | referencia contratual curada |
| `generico` | Conteudo util que nao encaixa ainda | titulo, dono, topico, sensibilidade, resumo e gaps | nota de conhecimento curada |

Default para legado: tratar ausencia de tipo como `sop` apenas para nao quebrar
o fluxo atual. O script de reclassificacao deve corrigir isso depois.

## 6. Saidas estruturadas por documento

Cada documento curado deve produzir, alem dos chunks, um registro estruturado de
conhecimento:

```ts
type KnowledgeExtraction = {
  documentType: DocumentType;
  authorityLevel: "authoritative" | "supporting" | "evidence" | "draft";
  summary: string;
  keyFacts: string[];
  decisions: Array<{ decision: string; date?: string; owner?: string }>;
  actions: Array<{ action: string; owner?: string; dueDate?: string; status?: string }>;
  rules: Array<{ rule: string; scope?: string; exception?: string }>;
  systems: Array<{ name: string; role?: string; integration?: string }>;
  processSteps: Array<{ step: string; actor?: string; system?: string; evidence?: string }>;
  risks: string[];
  openQuestions: string[];
  automationCandidates: AutomationCandidate[];
};
```

Essas extracoes nao precisam virar todas tabelas no primeiro ciclo. No MVP, o
snapshot completo pode ficar em JSON em `DocumentReview` ou em novo campo JSON
de `CurationDocument`. Candidatos de automacao, porem, devem ter tabela propria
quando entrarem no backlog, porque precisam de status, permissao, triagem e
aprovacao.

## 7. Automacoes: o que extrair e como avaliar

A ingestao deve identificar tarefas automatizaveis, mas com classificacao de
risco e maturidade.

```ts
type AutomationCandidate = {
  title: string;
  sourceDocumentId: string;
  evidenceChunks: Array<{ chunkIndex: number; quotePreview: string }>;
  processName?: string;
  trigger?: string;
  inputs: string[];
  outputs: string[];
  systems: string[];
  humanDecisions: string[];
  exceptionPaths: string[];
  frequency?: "ad_hoc" | "daily" | "weekly" | "monthly" | "event_driven";
  automationLevel: "none" | "assistida" | "parcial" | "total";
  automationLabel?: "sem_automacao" | "candidato" | "equivalente_automatizado_criado";
  confidence: number;
  risks: string[];
  requiredApprovals: string[];
  suggestedScriptType?: "playwright" | "api" | "etl" | "report" | "notification" | "checklist";
  status: "suggested" | "triaged" | "approved_for_design" | "implemented" | "rejected";
  indicatedBy?: { userId: string; role: "global_admin" | "sector_admin"; sector?: string };
};
```

Classificacao de automacao:

- `none`: documento e informativo; nao ha tarefa repetivel clara.
- `assistida`: IA pode montar checklist, preencher minuta, preparar payload ou
  guiar operador, mas humano decide.
- `parcial`: parte do fluxo pode ser scriptada, ou o fluxo pode ser
  orquestrado com checkpoint humano explicito no portal/fila.
- `total`: entradas, regras, execucao e validacao sao objetivas o bastante para
  script fim a fim.

Regra de seguranca: candidato de automacao nunca executa nada por estar em um
documento. Ele alimenta backlog e desenho tecnico.

Criterio refinado para `total`: uma automacao so deve ser marcada como total
quando nao precisar de uma acao intermediaria humana dentro do fluxo normal. Se
existir decisao, aprovacao, correcao manual ou entrada humana no meio do
processo, a classificacao inicial deve ser `parcial`.

Fluxos com etapa humana intermediaria podem ter equivalente automatizado criado,
mas devem permanecer classificados como `parcial`. Um label simples basta para
indicar que o processo ja possui equivalente automatizado, por exemplo
`equivalente_automatizado_criado`. Nesse caso, o script automatiza a
coordenacao, mas a decisao humana continua explicita, auditavel e pendente ate
resposta no portal/fila.

## 8. Pipeline refinado de ingestao

### 8.1 Pre-upload

1. Usuario seleciona arquivo ou pasta.
2. Sistema normaliza conteudo para Markdown.
3. Classificador sugere:
   - `documentType`
   - confianca
   - sinais usados
   - titulo
   - topico
   - sensibilidade sugerida
   - se parece hibrido
   - candidatos iniciais de automacao
4. Usuario confirma ou corrige antes de enviar.
5. Admin pode escolher setor; usuario comum fica no proprio setor.
6. `topic` e livre no MVP, preenchido pelo usuario ou sugerido pelo
   classificador, sem catalogo obrigatorio por setor.

### 8.2 Upload para staging

1. `handleCuratedUpload` recebe `documentType` confirmado.
2. Persiste `documentType`, `classificationSource`, `classificationConfidence`
   e metadados.
3. Chunks de staging recebem payload com:
   - `document_type`
   - `authority_level`
   - `topic`
   - `owner`
   - `sensitivity`
   - `source_document_id`
4. Documento entra em status coerente com o tipo.

### 8.3 Curadoria por tipo

O motor de readiness deve deixar de ser apenas `sopReadiness` e virar
`curationReadiness`, com perfil por tipo.

Politica inicial:

| Tipo | Gate minimo |
| --- | --- |
| `sop` | readiness SOP atual, com passos, responsaveis, entradas, saidas e excecoes |
| `norma` | autoridade, vigencia, escopo, obrigacoes e excecoes |
| `ata` | data, participantes, decisoes e acoes atribuiveis |
| `doc_tecnica` | sistemas, versao/escopo, dependencias e exemplos ou contratos |
| `faq` | perguntas e respostas claras, sem contradicao critica |
| `comunicado` | publico, validade, impacto e data de expiracao quando aplicavel |
| `relatorio` | periodo, metodologia, achados e limitacoes |
| `contrato` | partes, vigencia, obrigacoes e SLA/prazos |
| `generico` | titulo, topico, dono, sensibilidade, resumo e gaps |

### 8.4 Correlacao

Manter a correlacao atual contra a base produtiva, mas ajustar as perguntas por
tipo:

- SOP contra SOP: conflito de passos, responsaveis, excecoes.
- Norma contra SOP: norma pode invalidar procedimento existente.
- Ata contra base: decisoes podem alterar prioridade, dono ou prazo.
- Doc tecnica contra base: contratos/API podem contradizer exemplos antigos.
- Comunicado contra base: pode ter validade curta e nao deve substituir regra
  permanente sem aprovacao.

### 8.5 Promote

Promote passa a ter renderizador por tipo:

| Tipo | Renderizador |
| --- | --- |
| `sop` | `renderSopMarkdown` |
| `norma` | `renderPolicyReferenceMarkdown` |
| `ata` | `renderMeetingRecordMarkdown` |
| `doc_tecnica` | `renderTechnicalReferenceMarkdown` |
| `faq` | `renderFaqMarkdown` |
| `comunicado` | `renderAnnouncementMarkdown` |
| `relatorio` | `renderReportReferenceMarkdown` |
| `contrato` | `renderContractReferenceMarkdown` |
| `generico` | `renderKnowledgeNoteMarkdown` |

O Qdrant produtivo deve indexar o artefato curado, nao necessariamente um SOP.
O payload deve ter `source_type` igual ao tipo do artefato, por exemplo
`sop`, `policy_reference`, `meeting_record`, `technical_reference`.

Todos os tipos promovidos devem ter artefato fisico salvo. SOP continua em
`files/sop/<setor>/...` por compatibilidade; os demais devem ir para
`files/curated/<setor>/<tipo>/...`, mantendo referencia ao documento original,
versao, setor, dono e metadados de curadoria.

## 9. Mudancas de dados propostas

Adicionar em `CurationDocument`:

```prisma
documentType              String?  @map("document_type")
classificationSource      String?  @map("classification_source") // human | heuristic | llm | script
classificationConfidence  Float?   @map("classification_confidence")
authorityLevel            String?  @map("authority_level")
curationReadinessScore    Float?   @map("curation_readiness_score")
curationProfile           Json?    @map("curation_profile")
knowledgeExtraction       Json?    @map("knowledge_extraction")
```

Manter `sopReadinessScore` no primeiro ciclo por compatibilidade, mas tratar
como alias/debito para SOP. Depois migrar UI e rotas para
`curationReadinessScore`.

Adicionar tabela de candidatos de automacao. A decisao de produto e nao deixar
esses candidatos apenas dentro de JSON quando eles representarem backlog
avaliavel por admin. O JSON de `knowledgeExtraction` continua util como
snapshot da extracao, mas a fila operacional deve usar tabela propria.

```prisma
model AutomationCandidate {
  id                 String   @id @default(cuid())
  curationDocumentId String   @map("curation_document_id")
  sector             Sector
  title              String
  processName        String?  @map("process_name")
  automationLevel    String   @map("automation_level")
  suggestedScriptType String? @map("suggested_script_type")
  automationLabel    String?  @map("automation_label")
  indicatedByUserId  String?  @map("indicated_by_user_id")
  indicatedByRole    String?  @map("indicated_by_role")
  confidence         Float
  status             String   @default("suggested")
  payload            Json
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")
}
```

Persistencia recomendada:

- `knowledgeExtraction`: snapshot completo da leitura estruturada do documento.
- `AutomationCandidate`: itens que entraram no backlog de avaliacao.
- Status inicial `suggested`; somente admin geral ou admin do setor pode mover
  para `triaged` ou `approved_for_design`.
- `automationLabel`: label simples para marcar que o processo ja tem
  equivalente automatizado criado, sem mudar a classificacao de nivel.
- `indicatedByUserId` e `indicatedByRole`: registro da indicacao direta feita
  por admin geral ou admin do setor.

## 10. Modulos a criar ou adaptar

Novos:

- `lib/document-types.ts`: catalogo de tipos, perfis e helpers.
- `lib/document-classifier.ts`: heuristicas + fallback LLM.
- `lib/curation/profiles.ts`: perguntas e gates por tipo.
- `lib/curation/extraction.ts`: extracao estruturada de fatos, regras,
  decisoes, acoes e candidatos de automacao.
- `lib/curation/renderers.ts`: renderizadores por tipo.
- `app/api/classify/route.ts`: classificacao pre-upload, sem escrita.
- `scripts/reclassify-corpus.ts`: reclassifica documentos existentes.
- `scripts/extract-automation-candidates.ts`: roda extracao em documentos
  promovidos ou staged, com `--dry-run`.

Adaptar:

- `lib/curation/upload.ts`: aceitar `documentType` e persistir classificacao.
- `lib/curation/documents.ts`: trocar readiness SOP fixa por perfil por tipo.
- `lib/sop-readiness.ts`: manter para SOP, nao usar para tudo.
- `lib/sop-generator.ts`: manter para SOP e mover logica comum para renderer.
- `lib/qdrant.ts`: propagar `document_type`, `authority_level` e `source_type`.
- `lib/knowledge/capabilities.ts`: incluir tipo e sinais de automacao no texto
  de capacidade, sem expor conteudo sensivel.
- `components/sector-ingestion-workbench.tsx`: mostrar sugestao de tipo antes
  do envio.
- `components/curation-review-workbench.tsx`: renderizar perguntas por tipo e
  exibir candidatos de automacao como achados, nao como comandos.

## 11. Documentos hibridos

Documentos hibridos devem ser divididos quando a divisao melhora a utilidade.

Exemplos:

- Ata com decisao + procedimento anexo: `ata` e `sop`.
- Norma com FAQ no fim: `norma` e `faq`.
- Documento tecnico com checklist operacional: `doc_tecnica` e `sop`.

Modelo recomendado:

- Criar documentos logicos separados.
- Manter o mesmo `sourceDocumentIdRoot` ou `sourceBundleId`.
- Cada documento logico tem `documentType`, readiness e promote proprios.
- A UI mostra que eles vieram do mesmo arquivo original.

No MVP, se a divisao automatica for trabalhosa, classificar como tipo dominante
e abrir pergunta obrigatoria: "Este arquivo contem secoes que devem virar outro
documento curado?"

## 12. Scripts personalizados a partir do conhecimento

O sistema deve permitir chegar em scripts por esta cadeia:

1. Documento ingerido descreve processo, regra, sistema ou tarefa.
2. Extrator identifica candidato de automacao com evidencias.
3. Curador valida se a tarefa existe e se o fluxo esta correto.
4. Responsavel classifica nivel: assistida, parcial ou total.
   - Se houver humano no loop, o nivel deve ser `parcial`.
   - Se o processo ja tiver equivalente automatizado criado, registrar label
     proprio sem promover o nivel para `total`.
   - Indicacao direta para desenho so pode vir de admin geral ou admin do setor.
5. Forja/desenvolvimento desenha contrato do script:
   - entradas
   - saidas
   - sistemas acessados
   - credenciais/permissoes
   - checkpoints humanos
   - idempotencia
   - logs/auditoria
   - rollback ou compensacao
6. Script e implementado fora do fluxo RAG comum.
7. Chat so executa quando houver intent explicita, autorizacao e politica de
   aprovacao, como ja ocorre com `human-in-captcha`.

Artefato sugerido para cada oportunidade:

```markdown
# Candidato de automacao: <titulo>

## Evidencia
- Documento: <documentTitle>
- Secoes/chunks: <ids>

## Processo
<descricao curta>

## Entradas
- ...

## Saidas
- ...

## Sistemas
- ...

## Decisoes humanas
- ...

## Nivel sugerido
assistida | parcial | total

## Riscos
- ...

## Criterios para virar script
- dados de entrada estaveis
- regra deterministica
- ambiente de teste
- aprovacao do dono
- trilha de auditoria
```

## 13. Fases de execucao

### Fase 0 - Alinhar plano e contratos

Entregas:

- Este plano refinado.
- Decisao registrada em `memory.md`.
- Confirmacao de que `sop` e apenas um dos tipos promoviveis.
- Confirmacao de que todos os tipos da secao 5 entram no MVP.
- Confirmacao de que artefatos curados de todos os tipos terao arquivo fisico.
- Confirmacao de que `topic` sera livre no primeiro ciclo.

Criterio de saida:

- Time concorda com tipos iniciais e com o principio "artefato curado por tipo".

### Fase 1 - Fundacao de tipos

Entregas:

- `lib/document-types.ts`.
- Migration com campos de classificacao em `CurationDocument`.
- Migration com `AutomationCandidate`, mesmo que a UI completa venha depois.
- Payload Qdrant com `document_type` e `authority_level`.
- Testes unitarios de parser/perfil.

Criterio de saida:

- Documentos legados continuam funcionando.
- Novo upload pode carregar `documentType`.

### Fase 2 - Classificacao pre-upload

Entregas:

- `lib/document-classifier.ts`.
- `POST /api/classify`.
- UI de ingestao mostra sugestao, confianca e motivo.
- Usuario pode aceitar ou corrigir tipo.

Criterio de saida:

- Upload em lote permite revisar tipo antes de enviar.

### Fase 3 - Curadoria por tipo

Entregas:

- `lib/curation/profiles.ts`.
- Readiness por tipo.
- Perguntas adequadas a SOP, norma, ata, tecnica, FAQ, comunicado e generico.
- UI de curadoria mostra perfil aplicado.

Criterio de saida:

- Ata nao pede "passos do procedimento".
- SOP continua exigindo passos e excecoes.

### Fase 4 - Renderizadores e promote por tipo

Entregas:

- Renderizadores por tipo.
- Promote indexa artefato curado correto.
- `source_type` deixa de ser sempre `sop`.
- Capabilities consideram tipo do documento.

Criterio de saida:

- Documento tecnico promovido aparece como referencia tecnica.
- SOP promovido continua gerando SOP fisico.

### Fase 5 - Extracao de conhecimento e automacoes

Entregas:

- `lib/curation/extraction.ts`.
- `knowledgeExtraction` no documento.
- Candidatos de automacao exibidos na curadoria.
- Script `scripts/extract-automation-candidates.ts --dry-run`.

Criterio de saida:

- Curador ve oportunidades de automacao com evidencias e pode rejeitar/validar.

### Fase 6 - Backlog de automacoes

Entregas:

- Uso operacional da tabela `AutomationCandidate`.
- Tela admin simples por setor.
- Status: suggested, triaged, approved_for_design, implemented, rejected.
- Export para especificacao de script.
- Permissao de triagem/aprovacao restrita a admin geral ou admin do setor.

Criterio de saida:

- Existe uma fila real de automacoes derivadas de documentos, sem execucao
  automatica implicita.

### Fase 7 - Reclassificacao do corpus

Entregas:

- `scripts/reclassify-corpus.ts --dry-run`.
- Opcao `--apply`.
- Atualizacao de Postgres e payload Qdrant sem reembed quando possivel.

Criterio de saida:

- Corpus existente deixa de depender do default `sop`.

## 14. Decisoes recebidas e pontos restantes

Decisoes fechadas:

1. Tipos do MVP: todos os tipos descritos na secao 5 entram no escopo inicial:
   `sop`, `norma`, `ata`, `doc_tecnica`, `faq`, `comunicado`, `relatorio`,
   `contrato` e `generico`.
2. Artefato fisico: sim. Todo documento promovido deve gerar artefato fisico
   curado. SOP preserva o caminho atual; demais tipos devem usar
   `files/curated/<setor>/<tipo>/...`.
3. `topic`: livre no primeiro ciclo. Nao bloquear ingestao por catalogo setorial
   ainda.
4. Candidatos de automacao: criar tabela propria para backlog avaliavel. O JSON
   de extracao continua como snapshot, mas nao deve ser a unica fonte para
   triagem.
5. Aprovacao para desenho de automacao: somente admin geral ou admin do setor.
6. Automacao `total`: somente quando nao existir acao humana intermediaria
   necessaria no fluxo normal.
7. Humano no loop: classificar como `parcial`, mesmo quando a etapa humana for
   delegada ao portal/fila.
8. Processo com automacao equivalente ja criada: usar label simples, sem mudar
   o nivel de automacao.
9. Indicacao direta para desenho: permitida apenas por admin geral ou admin do
   setor.

Ponto para elaborar em rodada propria, sem bloquear a primeira implementacao:

1. Qual contrato minimo de execucao deve ser exigido antes de conectar um
   candidato aprovado a scripts reais.

## 15. Riscos

| Risco | Mitigacao |
| --- | --- |
| Classificador errar tipo e induzir curadoria ruim | Confirmacao humana obrigatoria e script de reclassificacao |
| Tudo virar `generico` por falta de confianca | Heuristicas conservadoras e UI que exige escolha quando confianca baixa |
| Automacoes sugeridas demais gerarem ruido | Exigir evidencia, frequencia, sistemas e beneficio antes de backlog |
| Documento sensivel virar capability compartilhavel | Sensibilidade continua gate de compartilhamento |
| Promote por tipo quebrar busca existente | Manter payload comum e testes de retrieval por tipo |
| SOP legado quebrar | Default temporario `sop` e manter `sopReadinessScore` ate migrar UI |

## 16. Validacao

Por fase de codigo:

```powershell
npx prisma generate
npm test
npm run lint
npm run build
```

Smokes manuais:

1. Ingerir um SOP e validar perguntas de procedimento.
2. Ingerir uma ata e validar decisoes/acoes, sem perguntas SOP.
3. Ingerir documento tecnico e validar sistemas/dependencias.
4. Ingerir comunicado com validade curta e validar que nao substitui norma.
5. Promover tipos diferentes e confirmar que o chat cita o artefato correto.
6. Rodar extracao de automacoes em modo `--dry-run` e revisar evidencias.

## 17. Proximo passo recomendado

Comecar pela Fase 1 e Fase 2 juntas, pois a classificacao precisa aparecer
antes do upload para cumprir a decisao de humano como fonte da verdade.

Implementacao minima inicial:

1. Criar catalogo de tipos.
2. Adicionar campos de classificacao no Prisma.
3. Criar classificador heuristico sem LLM no primeiro corte.
4. Criar `/api/classify`.
5. Exibir sugestao na fila de ingestao.
6. Persistir `documentType` confirmado.

So depois adaptar readiness e promote por tipo. Isso reduz risco e evita mexer
no fluxo aprovado de curadoria antes de termos dados reais de classificacao.
