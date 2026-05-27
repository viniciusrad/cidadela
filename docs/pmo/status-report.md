# Status Report — `pfrm-secure-agents`

Snapshot: **2026-05-02**
Período coberto: do início do projeto até hoje
Próxima atualização sugerida: 2026-05-09

## Status geral

🟡 **Amarelo** — protótipo técnico maduro; visão de produto ainda não está implementada ponta a ponta.

| Dimensão              | Status | Comentário curto                                                                  |
| --------------------- | :----: | --------------------------------------------------------------------------------- |
| Arquitetura técnica   | 🟢     | Isolamento setorial, bus, auditoria e RAG funcionam.                              |
| Loop de correção      | 🔴     | Sinal existe (`agent.unanswered`, feedback) mas não há fluxo até o responsável.   |
| Curadoria             | 🔴     | Não portada do `pfrm-chat`. Ingestão entra direto na produção.                    |
| Adoção                | 🟡     | Sem usuários reais ainda; só usuários-semente.                                    |
| Compliance / LGPD     | 🔴     | Sem DPIA, sem política de uso, sem classificação de tópicos sensíveis.            |
| Multicanal            | ⚪     | Fora do escopo da Fase 1 — só estratégia em documento.                            |
| Observabilidade       | 🔴     | Eventos auditados; KPI consolidado e dashboard não existem.                       |
| Cobertura de testes   | 🟡     | Unitários OK; sem E2E.                                                            |

## O que foi entregue até aqui

- Chat autenticado, sessão por setor (`auth.ts` + Auth.js Credentials).
- Coleções Qdrant separadas por setor; ingestão com validação por setor do usuário logado.
- Barramento RabbitMQ com tópico por agente; protocolos explícitos em `lib/agents/protocols.ts`.
- Classificador LLM + fallback de keywords para decidir delegação.
- Fallback local quando o bus não responde.
- Auditoria completa: `user.question`, `agent.answer`, `agent.unanswered`, `delegation.*`,
  `automation.*`, `user.feedback`.
- Telas administrativas: `/admin/feedback`, `/admin/audit`, `/admin/content`.
- Integração com `human-in-captcha` para 3 automações de Forja, com aprovação cross-agent.
- Smoke real validado: login, chat, delegação `desenvolvimento → seguranca`, fallback, auditoria.

## O que está em risco

- **Loop de correção (RED):** sem isso o produto não cumpre a visão.
- **DPIA/Compliance (RED):** sem aprovação de jurídico, qualquer expansão para usuários reais é
  exposição.
- **Resposta com 0 citações:** o agente ainda gera texto mesmo sem evidência. Política precisa mudar.
- **Sustentação operacional:** `ensureBusBootstrapped()` no caminho do request é débito.

## O que vai acontecer na próxima janela (próximas 2 semanas)

1. Definir patrocinador executivo e owner de produto.
2. Política de "não sei" implementada (recusa explícita + abertura de lacuna automática).
3. Esqueleto do painel de lacunas (sem atribuição ainda — só listagem priorizada).
4. Iniciar conversa formal com Compliance / Jurídico para DPIA.
5. Mapear donos de conhecimento por tópico do setor piloto.

## Decisões pendentes

- Setor piloto (recomendação: `desenvolvimento`, por estar mais bem servido em documentação).
- Política de retenção de logs de chat (LGPD).
- Threshold mínimo de score para responder (sugestão inicial: 0.45 cosine em `bge-m3`).
- Política de uso visível ao usuário no login.

## Pedidos do PMO ao patrocínio

- Confirmação do patrocinador executivo nominalmente.
- Ata informal autorizando o programa a "exigir" correção da fonte ao responsável humano dentro
  do prazo de SLA — caso contrário o loop vira sugestão e morre.
- Janela de 30 minutos com Compliance para enquadrar DPIA.
