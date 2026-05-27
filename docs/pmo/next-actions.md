# Next Actions — `pfrm-secure-agents`

Janela: 14 dias a partir de 2026-05-02
Princípio: ações concretas, com responsável proposto e critério de pronto. Sem ações genéricas tipo "melhorar X".

## Crítico — não pode escorregar

| #   | Ação                                                                                         | Responsável proposto | Critério de pronto                                                                            | Prazo sugerido |
| --- | -------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| A1  | Confirmar nominalmente patrocinador executivo e owner de produto.                            | PMO                  | Nome documentado em `charter.md` §7 com data.                                                  | 7 dias         |
| A2  | Reunião com Compliance / Jurídico para enquadrar DPIA e política de uso.                     | Owner + PMO          | Ata com lista de pendências de compliance e prazo de cada uma.                                | 7 dias         |
| A3  | Definir setor piloto e mapear seus 5 donos de conhecimento.                                  | Owner de produto     | Lista nomeada (5 pessoas, 5 tópicos), em `kpi-baseline.md` ou novo `pilot-setup.md`.            | 10 dias        |
| A4  | Implementar política de "não sei": agente recusa quando nenhuma citação atende ao threshold. | Tech Lead            | PR mergeado; teste cobrindo recusa; `agent.unanswered` continua sendo emitido.                | 10 dias        |
| A5  | Mover `ensureBusBootstrapped()` para inicialização do container.                             | Tech Lead            | Chat funciona sem warmup do bootstrap no caminho do request; `/api/health` reflete estado.    | 14 dias        |

## Alta prioridade — começa nesta janela

| #   | Ação                                                                                         | Responsável proposto | Critério de pronto                                                                            | Prazo sugerido |
| --- | -------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| A6  | Modelar tabela `KnowledgeOwner(topic, sector, userEmail)` no Prisma.                          | Tech Lead            | Migration aplicada; seed inicial com donos do setor piloto; testes.                           | 14 dias        |
| A7  | Esqueleto de `/admin/gaps`: lista perguntas sem citação suficiente, ordenadas por frequência. | Tech Lead            | Página acessível por admin; query agregando `agent.unanswered` + `bad feedback`.              | 14 dias        |
| A8  | Suite E2E mínima (Playwright): login → chat → delegação → feedback.                          | Tech Lead            | Pipeline CI roda E2E; falha bloqueia merge.                                                   | 14 dias        |
| A9  | Coletar baseline de KPIs em ambiente de teste (100 perguntas por setor).                     | Tech Lead + Owner    | Números registrados em `kpi-baseline.md`.                                                     | 14 dias        |
| A15 | Completar UI workspace de curadoria (`/admin/curation/<documentId>`).                        | Tech Lead            | Curador responde perguntas, aprova owner/admin e promove sem usar API manual.                  | 14 dias        |
| A16 | Smoke E2E de curadoria: upload → respostas → dupla aprovação → promote → chat cita SOP.      | Tech Lead            | Teste automatizado ou roteiro validado com SOP em `files/sop/<setor>/`.                       | 14 dias        |
| A17 | Calibrar `SOP_READINESS_THRESHOLD` com documentos piloto.                                    | Tech Lead + Owner    | Threshold registrado no decision-log ou ADR com amostra e taxa de aprovação/revisão.           | 14 dias        |

## Importante — preparar para próxima janela

| #   | Ação                                                                                         | Responsável proposto | Critério de pronto                                                                            | Prazo sugerido |
| --- | -------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| A10 | ADR sobre fallback local do bus (formaliza decisão D-003 e alerta).                          | Tech Lead            | `docs/adr/0002-bus-local-fallback.md` criado.                                                  | 14 dias        |
| A11 | ADR sobre política de "não sei" e threshold.                                                 | Tech Lead            | `docs/adr/0003-no-evidence-refusal.md` criado.                                                 | 14 dias        |
| A12 | Definir lista preliminar de tópicos sensíveis com Compliance.                                 | Compliance + Owner   | Lista assinada, integrada como configuração do detector.                                       | 21 dias        |
| A13 | Notificação por e-mail / Teams ao dono quando lacuna é aberta (POC).                         | Tech Lead            | Lacuna nova dispara notificação para o dono mapeado; configurável.                             | 21 dias        |
| A14 | Botão "esse trecho está errado" na citação, ligado a `documentId`/`chunkId`.                 | Tech Lead            | UI envia evento `user.flag` com referência; admin vê na fila de lacunas.                       | 21 dias        |

## Encaminhamentos para steering / patrocínio

- **Decisão pedida na próxima reunião:** SLA de correção exigível ao responsável humano (sem isso,
  R-19 fica sem mitigação real).
- **Decisão pedida na próxima reunião:** orçamento de tempo dos donos de conhecimento (1h/semana
  por dono, na fase piloto?).
- **Reportar ao steering:** os três riscos críticos (R-01, R-02, R-03) e o que cada um demanda do
  patrocínio para sair do vermelho.

## O que não fazer nesta janela

- **Não começar multicanal.** Vai criar pressão de escopo desnecessária.
- **Não migrar para NestJS.** Prematuro sem dados de produção.
- **Não adicionar 4º agente.** Vai aumentar combinação de protocolos sem necessidade.
- **Não trocar embedding model.** Vai exigir re-embedar e atrapalhar baseline.

## Como atualizar este arquivo

- Movimentar item para "Concluído" inline com data; manter por 30 dias antes de remover.
- Adicionar item novo apenas se conectado a Charter (§3-4) ou Risk Register.
- Itens sem responsável proposto não devem viver aqui.
