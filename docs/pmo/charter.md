# Project Charter — Ecossistema de Conhecimento Setorial (codinome `pfrm-secure-agents`)

Versão: 1.0 — 2026-05-02

## 1. Problema declarado

Conhecimento crítico de processos da companhia vive na cabeça de poucos colaboradores-chave.
Quando esses colaboradores estão indisponíveis, o processo trava ou é executado errado. A
documentação existente é dispersa, desatualizada e raramente acessível no momento da decisão.

## 2. Proposta de valor

Construir um ecossistema multiagente, com **bases de conhecimento isoladas por setor**,
**delegação intersetorial controlada** e — peça central — um **loop fechado** que transforma
toda lacuna detectada em sinal acionável para o responsável humano daquele conhecimento corrigir
ou validar a fonte.

A diferenciação competitiva sustentável é:

- Soberania de dado (modelos locais, sem envio externo).
- Auditoria completa por `traceId`, reproduzível.
- Isolamento setorial inegociável.
- Loop de correção como produto, não como afterthought.

## 3. Escopo

### Em escopo (MVP de produção — Fase 1)

- Chat autenticado por setor, com RAG local (Qdrant + Ollama).
- Delegação entre agentes via RabbitMQ.
- Auditoria persistida em Postgres.
- Painel administrativo para feedback e conteúdo.
- Política de "não sei" com abertura automática de lacuna.
- Painel de lacunas com atribuição e status.
- Curadoria com staging antes da publicação.
- KPIs operacionais.

### Fora de escopo nesta fase

- Multicanal (Teams/Telegram/WhatsApp) — backlog Fase 2.
- Migração para backend NestJS — backlog Fase 2.
- OCR de documentos escaneados.
- Agentes adicionais além de `desenvolvimento`, `seguranca`, `suporte` — só após Fase 1 estável.
- Conectores síncronos para sistemas externos (Confluence/SharePoint/etc.) — backlog Fase 2.

## 4. Critérios de sucesso da Fase 1

| Métrica                                                       | Meta                              |
| ------------------------------------------------------------- | --------------------------------- |
| % de respostas com pelo menos 1 citação acima do score mínimo | ≥ 75%                             |
| % de `agent.unanswered` que viram lacuna atribuída em 24h     | ≥ 90%                             |
| Tempo médio entre lacuna criada e correção publicada          | ≤ 7 dias úteis                    |
| Feedback positivo / total de feedback                         | ≥ 70% (após estabilização)        |
| Adoção semanal (DAU/WAU)                                      | ≥ 30 usuários únicos por semana   |
| Incidentes de resposta perigosa em tópico sensível            | 0                                 |

## 5. Premissas

- Modelos locais (`bge-m3`, `qwen3.5:4b`) atendem latência aceitável em hardware atual.
- Postgres, RabbitMQ e Qdrant estão sob a mesma infra operada pelo time interno.
- Existe patrocínio executivo declarado para exigir correção de fontes pelos responsáveis humanos.
- Documentação inicial dos setores é boa o suficiente para responder ≥ 50% das perguntas comuns.

## 6. Restrições

- LGPD: dados pessoais não devem trafegar para serviços externos. Toda inferência fica local.
- Setor regulado (farmacêutico): respostas em tópicos com impacto regulatório devem ter trilha
  auditável e disclaimer.
- Janela de manutenção: a infraestrutura pode parar para deploy semanalmente em horário pré-definido.
- Orçamento computacional: Ollama em CPU; se latência ficar inaceitável, projeto avaliará GPU
  dedicada antes de cogitar API externa.

## 7. Patrocínio e governança

| Papel                                       | Responsabilidade                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Patrocinador executivo (a confirmar)        | Decisão final de escopo, prioridades, orçamento, narrativa para diretoria.  |
| Owner de produto (a confirmar)              | Backlog, decisões de escopo dentro da Fase 1, aceite de entrega.            |
| Tech Lead (definido implicitamente)         | Arquitetura, qualidade, débito técnico, build/test/deploy.                  |
| Donos de conhecimento por setor (a mapear)  | Validar correção de fontes; responder lacunas atribuídas.                   |
| Compliance / Jurídico                       | DPIA, política de uso, classificação de tópicos sensíveis.                  |
| Segurança da informação                     | Revisão de superfície de ataque, gestão de credenciais, logs.               |

## 8. Marcos macro

| Marco                                                                     | Janela alvo |
| ------------------------------------------------------------------------- | ----------- |
| Loop de lacunas operando ponta a ponta com 1 setor piloto                  | 30 dias     |
| Curadoria com staging portada do `pfrm-chat`                               | 45 dias     |
| Painel de KPIs com baseline real                                          | 60 dias     |
| 3 setores em produção com ≥ 30 usuários ativos/semana                      | 90 dias     |
| Avaliação de canal Teams como segundo canal                                | 120 dias    |

## 9. Riscos macro

Detalhados em [`risk-register.md`](./risk-register.md). Os três críticos:

1. **Resistência cultural dos detentores de conhecimento tácito.**
2. **Resposta com confiança em tópico regulatório sem trilha legal de aprovação.**
3. **Ausência de loop de correção implementado — o sistema vira mais um chat genérico.**

## 10. Aprovações

| Item                                | Status     | Data | Aprovador |
| ----------------------------------- | ---------- | ---- | --------- |
| Carta do programa                    | Pendente   | --   | --        |
| Escopo da Fase 1                     | Pendente   | --   | --        |
| Patrocínio executivo                 | Pendente   | --   | --        |
