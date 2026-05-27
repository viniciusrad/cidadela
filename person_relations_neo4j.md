# Ontologia de Pessoas no Grafo — Plano de Ação

> Documento de trabalho para ponderação. Nada aqui foi implementado ainda.
> Arquivo solicitado como `person_relations_neo47.md`; criado como `person_relations_neo4j.md` (correção óbvia do typo `neo47`→`neo4j`). Renomeie se preferir o nome literal.
>
> Data: 2026-05-25 · Escopo: `pfrm-secure-agents` (Neo4j + Qdrant + Postgres)

---

## 1. O objetivo, lido sem rodeio

A meta não é "ter mais arestas no grafo". É produzir **dois ativos de negócio** a partir do conhecimento tribal:

1. **Mapa de automação** — uma lista priorizada de processos que *podem* ou *devem* ser automatizados, justificada por evidência: quem executa, em quantos sistemas, com qual cobertura documental e qual concentração de conhecimento (fator-ônibus).
2. **Horizontalização do acesso** — qualquer colaborador consegue, pela plataforma, descobrir "quem sabe sobre X", "quem executa o procedimento Y", "de quem depende o processo Z" — sem precisar perguntar no corredor.

A pessoa é o nó-chave porque o conhecimento tribal **mora na pessoa**, não no documento. O documento é só a evidência de onde inferimos a relação. Logo: a ontologia de pessoas precisa transformar menção (a pessoa apareceu num texto) em **papel operacional** (a pessoa *faz* algo num processo).

A distinção que comanda todo o resto:

> **Co-menção ≠ relação semântica.** Hoje o grafo só sabe que "Fulano" e o procedimento "fechamento de caixa" apareceram no mesmo chunk (`CO_OCCURS_WITH`). Isso não afirma que Fulano *executa* o fechamento. O plano inteiro é sobre **promover co-menção a relação tipada e com papel**, com evidência rastreável e correção humana onde a inferência for fraca.

---

## 2. Estado atual (verificado no código, não presumido)

### 2.1 Nós existentes
`Document`, `Concept`, `Procedure`, `System`, `Regulation`, `Person`, `Sector`, `Process`, `RagChunk`.

### 2.2 O nó `Person` hoje
- Propriedades: apenas `name`, `createdAt`. **Sem** e-mail canônico, **sem** setor, **sem** id estável.
- Arestas que tocam `Person`:
  - `(:Document)-[:INVOLVES_PERSON {roles?, evidenceChunkIds, evidenceChunkCount}]->(:Person)` — `roles` ∈ {executor, aprovador, owner, responsavel, autor}, detectado por regex em `lib/graph/extractor.ts`.
  - `(:RagChunk)-[:MENTIONS]->(:Person)` — evidência no nível do chunk.
  - `(:Person)-[:CO_OCCURS_WITH {relatedType, evidenceChunkIds, documentId}]->(:Procedure|:System)` — **co-ocorrência fraca** (mesmo chunk), criada por `linkPersonCoOccurrences()` em `lib/graph/persistence.ts`.

### 2.3 O nó `Process` já é o "alvo de automação"
`lib/graph/process-sync.ts` mantém `Process` com `automationReadinessScore`, `documentationCoverageScore`, `confidenceScore`, `recommendedAutomationLevel`, `status`. Arestas:
- `(:Sector)-[:OWNS]->(:Process)`
- `(:Process)-[:DESCRIBED_BY]->(:Document)`
- `(:Process)-[:COMPRISES]->(:Procedure)`
- `(:Process)-[:SUPPORTED_BY]->(:System)`
- `(:Process)-[:REQUIRES_CONCEPT]->(:Concept)` · `(:Process)-[:GOVERNED_BY]->(:Regulation)`

`Process` é alimentado por `lib/process-automation-map.ts`, que já consome Neo4j + curadoria + sinais. **É aqui que o mapa de automação já vive** — só falta a dimensão "pessoas".

### 2.4 Já existe correção humana de pessoas
`components/people-reclassify-panel.tsx` + `lib/graph/people-reclassify.ts` permitem reclassificar um `Person` que na verdade era Conceito/Sistema/etc., com undo. **Esse é o padrão de human-in-the-loop a reutilizar** para validar inferências fracas — não inventar um novo.

### 2.5 Cruzando com as 4 relações pedidas

| Relação desejada | Existe? | Hoje |
|---|---|---|
| pessoa **pertence** setor | ❌ Não existe | Só inferível por `Document.sector` agregado |
| pessoa **participa** processo | ❌ Não existe | Nenhuma aresta Person↔Process |
| pessoa **executa** procedimento | ⚠️ Parcial e fraca | `CO_OCCURS_WITH` sem papel, sem causalidade |
| pessoa **utiliza** sistema | ⚠️ Parcial e fraca | `CO_OCCURS_WITH` sem papel |

---

## 3. Ontologia proposta

### 3.1 As 4 relações pedidas (tipadas, com evidência e papel)

```text
(:Person)-[:BELONGS_TO        {confidence, source, sectors}]      ->(:Sector)
(:Person)-[:PARTICIPATES_IN   {roles, confidence, viaProcedures}] ->(:Process)
(:Person)-[:PERFORMS          {role, confidence, evidenceChunkIds}]->(:Procedure)
(:Person)-[:USES              {confidence, evidenceChunkIds}]      ->(:System)
```

Princípios em cada aresta:
- **`confidence`** ∈ {`extracted`, `co_occurrence`, `human_validated`}. Co-ocorrência entra como `co_occurrence` (sinal fraco, exibido como tracejado/"associação não validada", igual já se faz com `CO_MENTIONED`). Papel detectado pelo extractor entra como `extracted`. Curadoria humana promove para `human_validated`.
- **`evidenceChunkIds`** sempre presente — toda aresta é rastreável até o chunk de origem, mantendo a cadeia de verdade dos três stores.
- **`PERFORMS.role`** reaproveita os papéis já detectados (`executor`/`aprovador`/`owner`/`responsavel`/`autor`). "Executa" no sentido forte = `role IN [executor, responsavel]`.

### 3.2 Relações adicionais que recomendo (ponderar)

| Aresta | Por que vale a pena |
|---|---|
| `(:Person)-[:AUTHORED]->(:Document)` | Já temos `roles=[autor]`/wiki "last updated by". Mapeia quem mantém cada doc → alvo de revisão e fonte de conhecimento. |
| `(:Person)-[:KNOWS_ABOUT {strength}]->(:Concept)` | "Quem sabe sobre precificação?" — a horizontalização do acesso depende disso. Força = nº de docs/chunks. |
| `(:Person)-[:HANDS_OFF_TO]->(:Person)` | Detectada quando dois papéis (executor→aprovador) aparecem no mesmo procedimento. Revela handoffs humanos — exatamente o que a automação elimina. |

`BELONGS_TO`, `PARTICIPATES_IN`, `PERFORMS`, `USES` são a base obrigatória. `AUTHORED` e `KNOWS_ABOUT` saem quase de graça do que já é extraído. `HANDS_OFF_TO` é o maior salto de valor para automação, mas o de inferência mais delicada — proporia para uma onda posterior.

### 3.3 Enriquecimento do nó `Person`

```text
(:Person {
  name,                  // canônico já existente
  email,                 // novo: chave estável quando houver @profarma.com.br
  primarySector,         // novo: setor de maior incidência (deriva BELONGS_TO principal)
  documentCount,         // novo: materializado para ranking rápido
  isKeyPerson            // novo (flag): único executor de ≥1 procedimento (fator-ônibus=1)
})
```

`email` é o ponto crítico de **identidade**: hoje a chave é `name`, o que funde homônimos e quebra com variações ("João Silva" vs "Joao Silva" vs e-mail). Onde houver e-mail `@profarma.com.br`, ele deve virar a chave de identidade preferencial. (Decisão aberta — ver §7.)

---

## 4. Como isso vira o mapa de automação

O valor não está nas arestas, está nas **consultas de priorização** que elas habilitam. Todas alimentam o score que `lib/process-automation-map.ts` já calcula.

**a) Fator-ônibus por processo (concentração de conhecimento tribal):**
```cypher
MATCH (p:Process)-[:COMPRISES]->(proc:Procedure)<-[:PERFORMS {role:'executor'}]-(per:Person)
WITH p, proc, count(DISTINCT per) AS executores
WHERE executores = 1                       // só uma pessoa sabe executar
RETURN p.name, collect(proc.name) AS procedimentosDeRiscoUnico
ORDER BY size(procedimentosDeRiscoUnico) DESC
```
→ Processo com procedimentos de executor único = **conhecimento que vive na cabeça de uma pessoa** = candidato nº1 a documentar+automatizar. É a métrica central que o projeto persegue.

**b) Superfície de sistemas (custo de integração da automação):**
```cypher
MATCH (per:Person)-[:PARTICIPATES_IN]->(p:Process)
MATCH (p)-[:SUPPORTED_BY]->(s:System)
RETURN p.name, count(DISTINCT s) AS sistemas, count(DISTINCT per) AS pessoas
ORDER BY sistemas DESC
```
→ Muitos sistemas + poucas pessoas = trabalho manual de "cola entre sistemas" = alto ROI de automação (e casa direto com o fluxo human-in-captcha).

**c) Pessoa-chave (risco organizacional):**
```cypher
MATCH (per:Person)-[:PERFORMS {role:'executor'}]->(proc:Procedure)
WITH per, count(DISTINCT proc) AS procedimentos
WHERE procedimentos >= 3
RETURN per.name, per.primarySector, procedimentos
ORDER BY procedimentos DESC
```
→ Painel de risco de pessoa-chave (item já previsto no `UX_VALUE_REPORT.md`, antes adiado).

**d) Horizontalização — "quem sabe sobre X":**
```cypher
MATCH (per:Person)-[:KNOWS_ABOUT]->(c:Concept {name:'precificação'})
RETURN per.name, per.primarySector ORDER BY per.documentCount DESC
```

O resultado prático: cada `Process` ganha um **sinal de pessoas** (executores únicos, nº de participantes, handoffs) que entra no `automationReadinessScore` — transformando o mapa atual de "tem documentação?" em "tem documentação **e** depende de quantas cabeças?".

---

## 5. Plano de ação em ondas

Segue a convenção de "ondas" do repo. Cada onda é entregável e verificável de forma isolada. **Sem migration Prisma** — tudo é aditivo em Neo4j (schema-less) e nos payloads Qdrant já existentes.

### Onda 0 — Decisões e baseline (sem código)
- Fechar as decisões abertas do §7 (identidade por e-mail, fonte de verdade do setor, limiar de confiança).
- Rodar `npx tsx scripts/backfill-person-entities.ts --dry-run` para medir quantas `Person` e co-ocorrências já existem hoje — baseline antes/depois.
- **Critério de sucesso:** documento de decisões anexado aqui; baseline numérico registrado.

### Onda 1 — Tipar as relações Person→Procedure / Person→System
- Em `lib/graph/persistence.ts`, ao lado de `linkPersonCoOccurrences()`, derivar arestas tipadas:
  - `PERFORMS` quando o `Person` tem `roles` ∈ {executor, responsavel, owner} **e** co-ocorre com a `Procedure` (papel vindo de `INVOLVES_PERSON.roles`).
  - `USES` quando co-ocorre com `System`.
  - Manter `CO_OCCURS_WITH` como o sinal fraco residual (confidence `co_occurrence`) quando não houver papel.
- `confidence` e `evidenceChunkIds` em toda aresta nova.
- Teste novo em `tests/graph-persistence.test.ts` cobrindo: papel→`PERFORMS`, sem papel→`co_occurrence`.
- **Critério de sucesso:** dado um doc seed com "Executor: Fulano" + procedimento, o grafo cria `(:Person)-[:PERFORMS {role:'executor'}]->(:Procedure)`.

### Onda 2 — Relações Person→Sector e Person→Process
- `(:Person)-[:BELONGS_TO]->(:Sector)`: agregar `Document.sector` por pessoa; `primarySector` = setor de maior incidência; `confidence` proporcional à dominância. (Ou fonte autoritativa — §7.)
- `(:Person)-[:PARTICIPATES_IN]->(:Process)`: derivar por caminho `Person→Procedure(PERFORMS)←COMPRISES—Process` **e** `Person→Document(INVOLVES_PERSON)←DESCRIBED_BY—Process`. `roles` = união dos papéis nos procedimentos daquele processo.
- Adicionar `upsertPersonProcessLinks()` / `upsertPersonSectorLinks()` em `process-sync.ts` (vizinho natural do `Process`), respeitando o padrão "swallow + log" para não quebrar o write-path do Postgres em queda do Neo4j.
- **Critério de sucesso:** consulta (a) do §4 retorna processos com executor único nos dados seed.

### Onda 3 — Reingestão / backfill para popular as pessoas mapeadas
> **Esclarecimento importante:** "reingestão" aqui é **re-extração para o grafo (backfill)**, *não* re-embedding no Qdrant. As relações de pessoa vivem só no Neo4j; os chunks/payloads do Qdrant não mudam. Re-embedding (caro, depende de Ollama) só seria necessário se mudássemos chunking ou payload — **não é o caso**. Isso economiza a maior parte do esforço e respeita a simplicidade.

- Estender `scripts/backfill-person-entities.ts` (ou criar `scripts/backfill-person-relations.ts`) para, além de `Person`+`CO_OCCURS_WITH` que já faz, gerar `PERFORMS`/`USES`/`BELONGS_TO`/`PARTICIPATES_IN` com a lógica das Ondas 1–2.
- Idempotente (`MERGE`), com `--dry-run` e `--sector`, varrendo todos os `Document` já no grafo.
- Para docs **ainda não no grafo**: usar o "Radar de prioridade" já existente em `/admin/knowledge-graph` para extrair em lote — não há extração automática no promote (limitação conhecida nº1 do `docs/neo4j-knowledge-graph.md`).
- **Critério de sucesso:** após backfill, `listPersons()` e as consultas do §4 retornam dados não vazios nos 4 setores; nº de pessoas com `BELONGS_TO` ≈ nº de `Person` com documentos.

### Onda 4 — Sinal de pessoas no mapa de automação + UI
- `lib/process-automation-map.ts`: incorporar fator-ônibus, nº de executores e participantes no `automationReadinessScore`/recomendação.
- UI: aba/painel de **pessoas-chave** e **fator-ônibus por processo** (reaproveitar `graph-visualization.tsx` + `process-automation-map`); reusar `people-reclassify-panel.tsx` para validar/corrigir arestas fracas (promover `co_occurrence`→`human_validated`).
- **Critério de sucesso:** admin vê, por processo, "executado por N pessoas (M únicos)" e a recomendação de automação reflete a concentração.

### Onda 5 — Relações de alto valor (opcional, pós-validação)
- `AUTHORED`, `KNOWS_ABOUT`, `HANDS_OFF_TO`. Só após Ondas 1–4 validadas com dados reais, para não acumular inferência fraca não auditada.

---

## 6. Riscos e como mitigar

| Risco | Mitigação |
|---|---|
| **Falsos positivos** (co-menção tratada como execução) | Tipagem por `confidence`; co-ocorrência fica visualmente "não validada"; curadoria humana promove. Nunca tratar `co_occurrence` como verdade no score. |
| **Identidade de pessoa** (homônimos, variação de nome) | Chave por e-mail `@profarma` onde houver; merge guiado por humano para o resto. **Decisão §7.** |
| **Qualidade da extração de papel** (regex limitada) | Onda 1 usa o que já existe; melhoria por LLM/relation-extraction fica para depois, medida contra baseline. |
| **PII / sensibilidade** | Mapa de pessoas é dado sensível. Respeitar o gate: visível só a `role=admin`; nunca expor pessoa em retorno cross-sector. Confirmar política antes da UI (Onda 4). |
| **Neo4j fora do ar** | Manter padrão "swallow + log" do `process-sync.ts`; backfill é re-rodável. |

---

## 7. Decisões em aberto (preciso da sua percepção)

1. **Identidade da pessoa:** adotar e-mail `@profarma.com.br` como chave canônica (migrando de `name`)? Ou manter `name` e só anexar `email` como propriedade? Impacta de-duplicação de homônimos.
2. **Fonte de verdade do setor:** `BELONGS_TO` deve ser **inferido** dos documentos (rápido, sujeito a ruído) ou existe um **cadastro autoritativo** de RH/org (e-mail→setor) que possamos importar? Se existir, é muito mais confiável.
3. **Limiar de confiança:** a partir de quantos chunks/documentos uma co-ocorrência vira `PERFORMS` sugerido para validação? (proposta inicial: ≥1 com papel detectado, ≥2 sem papel.)
4. **Reingestão — escopo:** confirma que **não** queremos re-embedding no Qdrant, só backfill de grafo? (minha recomendação forte: sim, só grafo.)
5. **Onda 5 (`HANDS_OFF_TO` etc.):** entra no escopo agora ou só depois de validar o núcleo?
6. **Nome do arquivo:** mantenho `person_relations_neo4j.md` ou você quer o literal `person_relations_neo47.md`?

---

## 8. Resumo de uma frase

Promover **co-menção** a **relação tipada com papel e evidência** (`BELONGS_TO`/`PARTICIPATES_IN`/`PERFORMS`/`USES`), popular por **backfill de grafo** (sem re-embedding), e ligar o resultado ao `automationReadinessScore` já existente — para que o sistema deixe de dizer só "isto está documentado?" e passe a dizer "isto depende de quantas cabeças, e por isso deve ser automatizado?".
