# Risk Register — `pfrm-secure-agents`

Atualização: 2026-05-02

Convenção: Probabilidade (P) e Impacto (I) em escala 1-5. Severidade = P × I.

| ID   | Risco                                                                                       | P | I | Sev | Categoria        | Mitigação proposta                                                                                                  | Dono              | Status   |
| ---- | ------------------------------------------------------------------------------------------- | - | - | --- | ---------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- | -------- |
| R-01 | Resistência cultural de detentores de conhecimento tácito.                                  | 5 | 5 | 25  | Cultural         | Patrocínio executivo explícito; reconhecimento público de quem corrige; KPI de gestão (tempo de correção).          | Patrocinador      | Aberto   |
| R-02 | Resposta com confiança em tópico regulatório (ANVISA, LGPD) sem aprovação humana.            | 4 | 5 | 20  | Regulatório      | Lista de tópicos sensíveis com encaminhamento humano obrigatório; threshold mínimo de score.                        | Compliance + Tech | Aberto   |
| R-03 | Ausência de implementação do loop de lacuna → dono → correção; produto vira chat genérico.   | 5 | 4 | 20  | Produto          | Priorizar como item #1 do roadmap. Sem isso, não declarar Fase 1 concluída.                                         | Owner de produto  | Aberto   |
| R-04 | Adoção concentrada em early adopters; resto do público não usa.                              | 4 | 4 | 16  | Adoção           | Setor piloto único, com sucesso medido, antes de expandir. Embaixadores internos.                                   | Owner de produto  | Aberto   |
| R-05 | Falha do RabbitMQ silenciada por fallback local crônico.                                     | 3 | 4 | 12  | Operacional      | Alerta automático em `delegation.local_fallback` acima de N por hora. Auditoria revisada semanalmente.              | Tech Lead         | Aberto   |
| R-06 | Documentação de origem ruim impede ingestão útil; projeto trava em "vamos limpar primeiro".  | 4 | 3 | 12  | Conteúdo         | Upload entra em staging setorial; frontmatter ruim vira pergunta de curadoria e SOP-readiness bloqueia promote.      | Owner de produto  | Mitigando |
| R-07 | Disparo de automação via linguagem natural usado por usuário não autorizado.                 | 3 | 4 | 12  | Segurança        | ACL por usuário (não só por setor); rate limit; revisão periódica de execuções.                                     | Segurança         | Aberto   |
| R-08 | Ollama em CPU não suporta a carga de adoção real, gerando latência > 30s.                    | 4 | 3 | 12  | Operacional      | Pré-warm; fila de geração; avaliar GPU dedicada quando p95 > 15s por 3 dias seguidos.                               | Tech Lead         | Aberto   |
| R-09 | Embedding model trocado sem re-embeddar a base; respostas degradam silenciosamente.           | 2 | 5 | 10  | Técnico          | Versionamento de embedding model por chunk; impedir consulta cross-version.                                         | Tech Lead         | Aberto   |
| R-10 | Pressão para abrir backend para Teams/WhatsApp antes do loop de correção estar pronto.        | 4 | 3 | 12  | Escopo           | Defender a sequência do roadmap. Mostrar custo de qualidade ruim multiplicada por canais.                           | PMO + patrocínio  | Aberto   |
| R-11 | LGPD: chat captura PII em texto livre que cai em logs e auditoria sem masking.                | 4 | 4 | 16  | Privacidade      | Masking automático em `audit_events.payload`; classificação de mensagem antes da persistência.                      | Segurança + Tech  | Aberto   |
| R-12 | Saída de pessoa-chave sem ter alimentado o sistema mantém o problema original.                | 3 | 4 | 12  | Cultural         | KPI obrigatório por gestor: % do conhecimento de cada pessoa-chave coberto pela base.                              | RH + patrocínio   | Aberto   |
| R-13 | Bootstrap do bus no caminho do request causa primeira resposta lenta em produção.             | 3 | 2 | 6   | Operacional      | Mover `ensureBusBootstrapped()` para inicialização do container; healthcheck depende disso.                          | Tech Lead         | Aberto   |
| R-14 | Sem reranker, retrieval cita chunks fracos como fortes em corpus pequeno.                     | 4 | 3 | 12  | Qualidade        | Adicionar `bge-reranker-v2-m3`; medir antes/depois.                                                                 | Tech Lead         | Aberto   |
| R-15 | Conflito de versões no corpus (procedimento antigo vs. novo) sem `effective_from`.            | 4 | 3 | 12  | Conteúdo         | Promote substitui totalmente chunks produtivos por `sourceDocumentId`; `effective_from` e `supersedes` entram no SOP. | Tech Lead         | Mitigando |
| R-16 | "Por que não usamos ChatGPT/Copilot?" deslegitimando o investimento próprio.                  | 3 | 4 | 12  | Narrativa        | Discurso pronto sobre soberania, isolamento, custo do erro, auditoria. Patrocínio replica.                          | Patrocinador      | Aberto   |
| R-17 | Disclaimers e política de uso ausentes — risco jurídico em caso de dano por instrução errada. | 3 | 5 | 15  | Jurídico         | Política assinada no primeiro login; disclaimer fixo em respostas de tópico sensível.                               | Jurídico          | Aberto   |
| R-18 | Ausência de E2E test: regressão silenciosa entre login → chat → delegação → resposta.        | 3 | 3 | 9   | Qualidade        | Suite Playwright cobrindo o caminho dourado; rodar em CI.                                                           | Tech Lead         | Aberto   |
| R-19 | Backlog de lacunas cresce sem ação; sinal vira ruído.                                          | 4 | 4 | 16  | Operacional      | SLA por dono de tópico; escalonamento automático para gestor após X dias.                                           | Owner de produto  | Aberto   |
| R-20 | Custo total de propriedade subestimado (infra, sustentação, modelagem de tópicos).            | 3 | 3 | 9   | Financeiro       | Orçamento explícito para sustentação após Fase 1; reservar tempo do Tech Lead.                                      | Patrocinador      | Aberto   |

## Critérios para reclassificar

- **Aberto** → **Mitigando** quando ação concreta começa.
- **Mitigando** → **Controlado** quando métrica indica risco residual aceitável por 2 semanas.
- **Controlado** → **Encerrado** quando o gatilho do risco deixa de existir.

## Top-3 riscos a tratar nos próximos 30 dias

1. **R-03 — Loop de correção ausente.** Sem essa peça, o produto não justifica investimento.
2. **R-02 / R-17 — Resposta perigosa em tópico regulatório sem trilha legal.** Bloqueia adoção em escala.
3. **R-01 — Resistência cultural.** Sem patrocínio explícito e KPI gerencial, o loop não funciona mesmo se for construído.
