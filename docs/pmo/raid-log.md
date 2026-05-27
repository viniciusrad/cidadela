# RAID Log — `pfrm-secure-agents`

Atualização: 2026-05-02
Convenção: R = risco, A = premissa (Assumption), I = issue, D = dependência.

| ID    | Tipo | Descrição                                                                                          | Dono              | Status   |
| ----- | :--: | -------------------------------------------------------------------------------------------------- | ----------------- | -------- |
| RA-01 | R    | Resistência cultural de detentores de conhecimento. Vide `risk-register.md` R-01.                  | Patrocinador      | Aberto   |
| RA-02 | A    | Patrocínio executivo aprovará SLA de correção exigível ao responsável humano.                       | Patrocinador      | A validar |
| RA-03 | A    | Modelos locais (`bge-m3`, `qwen3.5:4b`) sustentam a Fase 1 sem GPU dedicada.                        | Tech Lead         | A validar |
| RA-04 | A    | Documentação inicial dos setores cobre ≥ 50% das perguntas comuns.                                 | Owner de produto  | A validar |
| RA-05 | A    | Compliance / Jurídico aceita avaliar DPIA dentro de 4 semanas.                                      | Compliance        | A validar |
| RA-06 | I    | `agent.unanswered` registrado, sem destino humano configurado.                                      | Tech Lead         | Aberto   |
| RA-07 | I    | Curadoria com staging não foi portada do `pfrm-chat` para `pfrm-secure-agents`.                     | Tech Lead         | Mitigando |
| RA-08 | I    | Bootstrap do bus mistura inicialização operacional com tráfego HTTP.                                | Tech Lead         | Aberto   |
| RA-09 | I    | Sem painel de KPI consolidando feedback, lacunas, delegação e métricas de qualidade de resposta.    | Tech Lead         | Aberto   |
| RA-10 | I    | `responsibleArea` por chunk existe em `pfrm-chat`, não em `pfrm-secure-agents`.                     | Tech Lead         | Mitigando |
| RA-11 | I    | Política de "não sei" não implementada; agente gera texto mesmo sem citação relevante.              | Tech Lead         | Aberto   |
| RA-12 | I    | Sem suite E2E cobrindo login → chat → delegação → feedback → admin.                                | Tech Lead         | Aberto   |
| RA-13 | I    | `human-in-captcha` pode ser disparado por qualquer usuário do setor `desenvolvimento` via texto.    | Segurança         | Aberto   |
| RA-14 | D    | Disponibilidade de uma rede Docker compartilhada `pfrm-local-internal` para integração interna.     | Operações         | Atendida |
| RA-15 | D    | Acesso ao `human-in-captcha` em rede privada, com `INTERNAL_AUTOMATION_TOKEN` válido.               | Operações         | Atendida |
| RA-16 | D    | Postgres / RabbitMQ / Qdrant operados pela infraestrutura interna em ambiente não-local.            | Operações         | Pendente |
| RA-17 | D    | Compromisso formal dos donos de conhecimento (a mapear) para responder dentro de SLA.               | Patrocinador      | Pendente |
| RA-18 | D    | Aprovação de Compliance para captura/retenção de mensagens em tabela `messages`.                    | Compliance        | Pendente |
| RA-19 | D    | Definição da política de uso visível ao usuário no primeiro login.                                  | Jurídico          | Pendente |
| RA-20 | D    | Modelos Ollama disponíveis nos hosts de produção (`bootstrap-models.ps1`).                          | Operações         | Pendente |

## Issues que travam a Fase 1

- **RA-06 + RA-09 + RA-10 + RA-11** travam o loop de lacuna → dono → correção, que é o coração da Fase 1.
- **RA-07** trava qualidade da base sustentável.
- **RA-18 + RA-19** travam expansão para usuários reais fora do círculo-piloto.
