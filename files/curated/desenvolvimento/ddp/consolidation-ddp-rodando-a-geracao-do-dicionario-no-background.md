---
curated_id: consolidation-ddp-rodando-a-geracao-do-dicionario-no-background
document_type: ddp
source_type: process_description
sector: desenvolvimento
owner: vinicius.souza@profarma.com.br
topic: Rodando a geração do dicionario no background:
authority_level: draft
effective_from: null
supersedes: null
sensitivity: internal
generated_at: 2026-05-22T20:17:04.602Z
generator_version: 1
generated_by: deterministic-curation-renderer
source_document_hash: dd916972c614c52f09aa8ea86ceaf6b39cb2161008bf7118cb430a86c03938f7
---

# DDP - Rodando a geração do dicionario no background:

## 1. Objetivo e contexto
--- document_type: ddp source_type: process_description classification_source: script authority_level: draft generated_at: 2026-05-15T20:41:04.806Z lineage_source_documents: desenvolvimento:60685568e3a03627121b394c51d2be35c757c4accc04b9f3b840b27af90b2705 --- # DDP - Rodando a geração do dicionario no background: ## 1. Objetivo do processo Gerar automaticamente os dicionários MasterFarma e Associadas para garantir a disponibilidade dos dados estruturados necessários. ## 2. Gatilhos e contexto Ocorre no setor de desenvolvimento, sendo executado periodicamente (diariamente às 06:00 e 06:30) e env

## 2. Regras e observacoes de curadoria
- Qual e o objetivo e o contexto do processo descrito?: descrever o sistema de envio de dicionarios de preços para os crientes especificados
- Quais gatilhos, atores, sistemas, handoffs e dependencias precisam constar?: todos os dados para a execução do script estão disponiveis a partir de consultas realizadas pelos proprios scripts do processo, dependendo apenas do agendamento do cron
- Quais regras, excecoes, entradas e saidas devem ser preservadas?: esse procedimento trata apenas dos clientes referenciados neste documento

## 3. Conteudo consolidado
---
document_type: ddp
source_type: process_description
classification_source: script
authority_level: draft
generated_at: 2026-05-15T20:41:04.806Z
lineage_source_documents: desenvolvimento:60685568e3a03627121b394c51d2be35c757c4accc04b9f3b840b27af90b2705
---

# DDP - Rodando a geração do dicionario no background:

## 1. Objetivo do processo
Gerar automaticamente os dicionários MasterFarma e Associadas para garantir a disponibilidade dos dados estruturados necessários.

## 2. Gatilhos e contexto
Ocorre no setor de desenvolvimento, sendo executado periodicamente (diariamente às 06:00 e 06:30) e envolve scripts PHP específicos localizados em /opt/edi_profarma/dic/.

- Agendamento via cron (0 6 * * * e 30 6 * * *)
- Execução manual via nohup

## 3. Atores
- Sistema de agendamento (Cron)
- Operador de sistema (para verificação)

## 4. Sistemas e dependencias
- /usr/bin/php
- /opt/edi_profarma/dic/gera_dic_masterfarma.php
- /opt/edi_profarma/dic/gera_dic_associadas.php
- Sistema de monitoramento (ps -ef)

## 5. Entradas
- Configuração do crontab
- Scripts PHP de geração de dicionário
- Ambiente de desenvolvimento configurado

## 6. Saidas
- Dicionário MasterFarma gerado
- Dicionário Associadas gerado
- Lista de processos ativos (via grep)

## 7. Regras e restricoes
- Execução obrigatória das tarefas às 06:00 e 06:30
- Verificação da execução deve ser realizada via comando ps -ef | grep dic

## 8. Excecoes
- Dicionários gerados via SAP (não via este processo)
- Falha na execução do script PHP (não especificada, mas implica verificação via ps)

## 9. Fluxo consolidado
1. Configurar o crontab com as tarefas agendadas para 06:00 e 06:30.
2. Executar o script gera_dic_masterfarma.php via PHP.
3. Executar o script gera_dic_associadas.php via PHP.
4. Verificar a execução dos processos utilizando o comando ps -ef | grep dic.

## 10. Handoffs e dependencias
- Dados gerados são utilizados em outros processos ou sistemas (não especificado)
- Monitoramento manual depende da execução correta do cron

## 11. Fundamentacao consolidada
O processo consiste na execução agendada de scripts PHP para gerar dicionários específicos (MasterFarma e Associadas) no ambiente de desenvolvimento, utilizando agendamento via cron e verificação manual via processo.

## 12. Perguntas pendentes de curadoria
- Qual é o comportamento esperado se o script PHP falhar?
- Quais são os prazos de entrega ou SLA para a geração dos dicionários?

## 13. Lineage e referencias
- Rodando a geração do dicionario no background: | setor=desenvolvimento | origem=promoted | sourceDocumentId=60685568e3a03627121b394c51d2be35c757c4accc04b9f3b840b27af90b2705

## 4. Referencias
- Documento fonte: consolidation-ddp-rodando-a-geracao-do-dicionario-no-background
- Setor: desenvolvimento
