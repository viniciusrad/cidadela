# Decision Log — `pfrm-secure-agents`

Registro cronológico de decisões. Cada decisão tem:

- **ID** (sequencial)
- **Data**
- **Decisão**
- **Motivação**
- **Alternativas consideradas**
- **Implicações**
- **Quem decidiu**

---

## D-001 — 2026-04-24 — Criar componente irmão `pfrm-secure-agents` em vez de evoluir `pfrm-chat`

**Decisão:** continuidade de produto rumo à produção em um novo componente irmão (`pfrm-secure-agents`),
mantendo o MVP `pfrm-chat` intacto.

**Motivação:** preservar o MVP demonstrável estável; introduzir Auth.js, Prisma, RabbitMQ e isolamento
setorial sem quebrar a base que já é usada em demonstrações.

**Alternativas:** evoluir `pfrm-chat` no mesmo repositório.

**Implicações:** dois codebases para sustentar; risco de divergência. Aceito porque o MVP serve a um
público (demo executiva) e o novo serve a outro (produção).

**Decidido por:** time técnico.

---

## D-002 — 2026-04-30 — Disparo de automações via linguagem natural exige confirmação cross-agent

**Decisão:** quando setor diferente de `desenvolvimento` solicita automação da Forja, o chat exige
confirmação adicional com motivo curto antes de enfileirar.

**Motivação:** evitar que NLU equivocada execute ação irreversível em sistema externo.

**Alternativas:** não permitir cross-sector; permitir sem confirmação.

**Implicações:** UX ligeiramente mais lenta para Sentinela/Helpdesk. Trade-off aceitável.

**Decidido por:** time técnico.

---

## D-003 — 2026-04-24 — Fallback local quando RabbitMQ não responde a tempo

**Decisão:** quando o bus não retorna dentro do prazo, o agente origem chama `answerAgentInternally()`
contra a coleção do setor destino, registra `delegation.local_fallback` e segue.

**Motivação:** preservar UX em caso de falha transitória do bus.

**Alternativas:** retornar erro; manter usuário esperando indefinidamente.

**Implicações:** **risco de mascarar falha crônica do bus.** Mitigação requer alerta automático
(R-05). A promessa "agente destino responde" passa a ser "base destino responde".

**Decidido por:** time técnico. Revisão recomendada após telemetria de produção.

---

## D-004 — 2026-05-04 — Separar coleção produtiva e coleção de staging por setor

**Decisão:** cada setor mantém uma coleção Qdrant produtiva (`rag_<setor>`) e uma coleção de
aprovação (`rag_<setor>_staging`) para documentos em curadoria.

**Motivação:** impedir que conteúdo bruto ou ainda não aprovado influencie respostas do chat.

**Alternativas:** staging global; continuar promovendo direto para produção.

**Implicações:** upload passa a exigir fluxo de curadoria e promote; aumenta a disciplina operacional,
mas preserva isolamento setorial e qualidade da base.

**Decidido por:** time técnico, a partir de `docs/plans/ingestao-curada-staging-sop.md`.

---

## D-005 — 2026-05-04 — SOP é o formato canônico promovido para produção

**Decisão:** o promote gera um SOP Markdown físico em `files/sop/<setor>/<sourceDocumentId>.md`
e indexa o SOP na coleção produtiva.

**Motivação:** tornar a base produtiva auditável, padronizada e pronta para operação.

**Alternativas:** indexar o conteúdo bruto aprovado; guardar SOP apenas no banco.

**Implicações:** a qualidade do SOP depende de respostas humanas de curadoria; o arquivo físico vira
artefato operacional rastreável.

**Decidido por:** time técnico, a partir de `docs/plans/ingestao-curada-staging-sop.md`.

---

## D-006 — 2026-05-04 — Promote substitui totalmente a versão produtiva por `sourceDocumentId`

**Decisão:** ao promover, os chunks produtivos anteriores do mesmo `sourceDocumentId` são removidos
e substituídos pelos chunks do SOP gerado.

**Motivação:** evitar conflito entre versões antigas e novas do mesmo procedimento.

**Alternativas:** coexistência com filtro temporal por `effective_from`.

**Implicações:** histórico de curadoria permanece no Postgres; Qdrant fica otimizado para o estado
produtivo vigente.

**Decidido por:** time técnico, a partir de `docs/plans/ingestao-curada-staging-sop.md`.

---

## D-007 — 2026-05-04 — Curadoria exige aprovação owner + admin no piloto

**Decisão:** promote exige aprovação de owner e admin; no piloto o mesmo admin pode acumular os dois
papéis via `CURATION_ALLOW_SAME_USER_DUAL_APPROVAL=true`.

**Motivação:** atender o gate humano sem bloquear o piloto por ausência de catálogo completo de owners.

**Alternativas:** uma aprovação só; dois usuários obrigatoriamente distintos desde o início.

**Implicações:** produção deve revisar a flag antes do go-live com usuários reais.

**Decidido por:** time técnico, a partir de `docs/plans/ingestao-curada-staging-sop.md`.

---

## Decisões pendentes (chamar registro D-008+ quando tomadas)

| Tema                                                  | Quem decide               | Prazo sugerido |
| ----------------------------------------------------- | ------------------------- | -------------- |
| Setor piloto da Fase 1                                 | Owner de produto           | Semana 1       |
| Threshold mínimo de score para resposta                | Tech Lead + Owner          | Semana 2       |
| Política de retenção de mensagens                      | Compliance + Patrocinador  | Semana 3       |
| Política de uso visível ao usuário                     | Jurídico                   | Semana 4       |
| Escolher reranker (`bge-reranker-v2-m3` ou alternativa)| Tech Lead                  | Fase 2         |
| Avaliar GPU dedicada                                   | Tech Lead + Patrocinador   | Após métrica   |
| Avaliar migração para NestJS                           | Tech Lead + Patrocinador   | Fase 4         |

## Como registrar uma nova decisão

1. Próximo ID disponível.
2. Data ISO.
3. Decisão em uma frase no presente do indicativo.
4. Motivação em até 3 linhas.
5. Pelo menos uma alternativa considerada.
6. Implicações de aceite e risco residual.
7. Nome de quem decidiu (não "o time"; nome).
