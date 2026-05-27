# Stakeholder Map — `pfrm-secure-agents`

Atualização: 2026-05-02
Eixos: Influência (capacidade de viabilizar/bloquear) × Interesse (engajamento provável).

## Quadrantes

### Alto interesse + alta influência — gerenciar de perto

| Stakeholder                              | Postura provável | Como engajar                                                                            |
| ---------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| Patrocinador executivo (a confirmar)     | Aliado           | Status mensal, narrativa de soberania de dado, decisão sobre SLA de correção.           |
| Owner de produto (a confirmar)           | Aliado           | Backlog vivo, decisões semanais, foco em loop de correção.                              |
| Tech Lead (atual time `pfrm-secure-agents`) | Aliado        | Autonomia para arquitetura; cobrar débito técnico explícito.                            |
| Compliance / Jurídico                    | Cético           | Reunião dedicada para DPIA; mostrar trilha auditável; pedir aprovação fase-a-fase.       |
| Segurança da informação                  | Cético construtivo | Revisão da superfície (auth, automação por NL, rede Docker); incluir em decisões críticas. |

### Alta influência + baixo interesse — manter satisfeitos

| Stakeholder                              | Postura provável | Como engajar                                                                            |
| ---------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| Diretoria (não-patrocinadora)            | Neutra a curiosa | Demos curtas em marcos; resumo de uma página com narrativa estratégica.                  |
| Operações de TI / Sustentação            | Cética           | Documentação de runbook; alertas; janela de manutenção.                                  |
| Comitê de tecnologia / arquitetura       | Avaliativa       | Decisão sobre Ollama local vs. API externa; convite a revisar ADRs.                      |

### Alto interesse + baixa influência — manter informados

| Stakeholder                              | Postura provável | Como engajar                                                                            |
| ---------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| Usuários-piloto (setor escolhido)        | Curiosa          | Demos abertas; canal de sugestão; ouvir feedback semanalmente.                           |
| Donos de conhecimento por tópico         | Mista            | Onboarding individual; explicar o "porquê"; reconhecer quem corrige primeiro.             |
| RH / Treinamento                         | Aliada potencial | Posicionar como ferramenta de onboarding; pedir conexão com mapas de competência.        |

### Baixa influência + baixo interesse — monitorar

| Stakeholder                              | Postura provável | Como engajar                                                                            |
| ---------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| Usuários gerais fora do piloto           | Indiferente      | Comunicação mínima até Fase 3.                                                          |
| Fornecedores externos                    | Indiferente      | Sem ação.                                                                               |

## Postura específica esperada

### Detentores de conhecimento tácito (atenção especial)

- **Resistência implícita** é mais provável que oposição declarada.
- Padrões a observar: documentação enviada vaga, indisponibilidade para revisar, reclamações
  genéricas sobre a IA "estar errada" sem indicar onde.
- Mitigação: mostrar como o sistema **amplia** a influência da pessoa (a fonte vira referência
  amplamente consultada), em vez de **reduzi-la**. Reconhecer publicamente.

### Compliance / Jurídico

- Não vai aprovar nada genérico. Pedirá DPIA, política de uso, classificação de tópicos sensíveis,
  política de retenção, masking de PII em logs.
- **Engajamento precoce reduz risco mais que qualquer arquitetura defensiva.**

### Segurança da informação

- Vai questionar três coisas:
  1. Surface de ataque do disparo de automação por NL.
  2. Isolamento do Ollama / RabbitMQ / Postgres.
  3. Logs e retenção.
- Tratar como aliado técnico (não como bloqueador) e levar ADR de cada decisão.

## Comunicação sugerida

| Frequência | Audiência                              | Canal              | Formato                                             |
| ---------- | -------------------------------------- | ------------------ | --------------------------------------------------- |
| Semanal    | Owner + Tech Lead + Patrocinador       | E-mail             | `status-report.md` snapshot                         |
| Quinzenal  | + Compliance + Segurança               | Reunião 30 min     | Status + decisões pendentes                         |
| Mensal     | Steering committee                     | Reunião 1h         | KPI + roadmap + risco                               |
| Sob demanda| Donos de conhecimento                  | Mensagem direta    | Notificação de lacuna atribuída                     |
