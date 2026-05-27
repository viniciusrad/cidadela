# KPI Baseline — `pfrm-secure-agents`

Atualização: 2026-05-02
Status atual: **baseline ainda não medido em ambiente real.** Este documento define como medir.

## Princípios

- Toda KPI tem **definição operacional** (de onde sai o dado).
- Toda KPI tem **meta** (o número que justifica investimento).
- Toda KPI tem **dono** (quem é cobrado pelo número).
- KPIs sem dono não devem existir.

## KPIs propostos

### Qualidade de resposta

| KPI                                                 | Definição                                                                                                                    | Meta Fase 1 | Dono              | Coleta                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------- | ---------------------------------------------------------------------- |
| % de respostas com ≥ 1 citação acima do score mínimo| Mensagens `assistant` com `citations.length > 0` e `score ≥ threshold` ÷ total de mensagens `assistant`.                      | ≥ 75%       | Tech Lead         | Query Postgres em `messages.citations`.                                |
| Feedback positivo / total                            | `audit_events.eventType = 'user.feedback' AND payload.value = 'good'` ÷ total de feedback.                                  | ≥ 70%       | Owner de produto  | Query Postgres em `audit_events`.                                      |
| Taxa de `agent.unanswered`                           | `audit_events.eventType = 'agent.unanswered'` ÷ total de `user.question`.                                                    | ≤ 15%       | Tech Lead         | Query Postgres em `audit_events`.                                      |

### Loop de correção

| KPI                                                 | Definição                                                                                                                     | Meta Fase 1 | Dono              | Coleta                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------- | ---------------------------------------------------------------------- |
| Lacunas atribuídas em até 24h                        | (ainda não modelado) Tempo entre `agent.unanswered` ou `bad feedback` e atribuição a um dono humano.                           | ≥ 90%       | Owner de produto  | A criar com modelo `KnowledgeOwner` + tabela `KnowledgeGap`.           |
| MTTR de correção                                     | Tempo entre lacuna criada e documento corrigido publicado.                                                                    | ≤ 7 dias    | Owner de produto  | Mesmo que acima.                                                       |
| Lacunas em aberto > 14 dias                          | Lacunas atribuídas e não resolvidas em 14 dias.                                                                              | 0           | Owner de produto  | Mesmo que acima.                                                       |

### Adoção e engajamento

| KPI                                                 | Definição                                                                                                                     | Meta Fase 1 | Dono              | Coleta                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------- | ---------------------------------------------------------------------- |
| Usuários ativos por semana (WAU)                     | `count(distinct conversations.userId)` em 7 dias com pelo menos 1 mensagem.                                                   | ≥ 30        | Owner de produto  | Query Postgres.                                                        |
| Conversas por usuário ativo                          | Total de conversas por WAU.                                                                                                   | ≥ 3         | Owner de produto  | Query Postgres.                                                        |
| Retenção (W2 / W1)                                   | Usuários ativos na semana N+1 que também foram ativos na semana N.                                                           | ≥ 50%       | Owner de produto  | Query Postgres.                                                        |

### Operacional / técnica

| KPI                                                 | Definição                                                                                                                     | Meta Fase 1 | Dono              | Coleta                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------- | ---------------------------------------------------------------------- |
| Latência p95 da resposta (search + generation)      | Percentil 95 de `metrics.totalDurationMs` em respostas finais.                                                                | ≤ 15 s      | Tech Lead         | A capturar em painel a partir de `messages` ou `audit_events`.         |
| % de delegações com `local_fallback`                | `audit_events.eventType = 'delegation.local_fallback'` ÷ total de delegações.                                                | ≤ 5%        | Tech Lead         | Query Postgres.                                                        |
| Taxa de erro do bus                                  | `delegation.timeout` + `delegation.bus_unavailable` ÷ total de delegações.                                                    | ≤ 1%        | Tech Lead         | Query Postgres.                                                        |
| Disponibilidade da aplicação                         | Uptime mensal medido por healthcheck externo.                                                                                | ≥ 99%       | Operações         | Healthcheck externo.                                                   |

### Segurança e compliance

| KPI                                                 | Definição                                                                                                                     | Meta Fase 1 | Dono              | Coleta                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------- | ---------------------------------------------------------------------- |
| Disparos de automação não autorizados                | `automation.requested` por usuários sem ACL apropriada.                                                                       | 0           | Segurança         | Query Postgres + lista de ACL.                                         |
| Respostas em tópico sensível sem disclaimer          | A definir após classificador de tópico sensível.                                                                              | 0           | Compliance        | A criar.                                                               |

## Baseline a coletar nas próximas 2 semanas

Mesmo sem usuários reais, é possível coletar:

- % de respostas com ≥ 1 citação (corpus seed) — pode-se simular 100 perguntas por setor.
- Latência p95 com modelos atuais.
- Taxa de delegação local fallback em ambiente de teste.

Os números coletados aqui viram o **baseline contra o qual se mede a melhoria**.

## Painel proposto (mínimo viável)

Tabela única em `/admin/kpi`:

- Cards: feedback %, unanswered %, citações %, WAU, lacunas em aberto.
- Gráfico de tendência por semana das principais.
- Lista das 10 perguntas mais recentes sem citação suficiente, com link para abrir lacuna.

Sem esse painel, todo o resto vira teatro de KPI.
