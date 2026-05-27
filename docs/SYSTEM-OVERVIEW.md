# PFRM Secure Agents — Visão Geral do Sistema

Este documento fornece um detalhamento abrangente das funcionalidades, arquitetura e fluxos operacionais do portal **PFRM Secure Agents**. Ele serve como base para o planejamento de apresentações a gestores, stakeholders e colaboradores.

---

## 1. Visão Geral
O **PFRM Secure Agents** é uma plataforma avançada de assistência baseada em Inteligência Artificial, projetada para gerenciar o conhecimento corporativo de forma segura, auditável e setorial. 

Diferente de assistentes genéricos, o sistema organiza o conhecimento em "Agentes Especializados" por setor (Desenvolvimento, Segurança, Suporte), garantindo que cada usuário interaja com o contexto apropriado à sua função, mantendo o isolamento de dados sensíveis.

### Objetivos Principais
- **Centralização do Conhecimento:** Unificar documentos técnicos, manuais e políticas em uma interface de chat inteligente.
- **Segurança e Isolamento:** Garantir que informações de um setor não vazem indevidamente para outro.
- **Eficiência Operacional:** Automatizar tarefas repetitivas e agilizar a busca por informações complexas.
- **Auditabilidade:** Registrar cada interação, delegação entre agentes e execução de automação.

---

## 2. Arquitetura de Agentes

O sistema opera sob o conceito de **Multi-Agentes**, onde cada setor possui um "Agente" com personalidade e base de conhecimento própria.

| Agente | Setor | Especialidade |
| :--- | :--- | :--- |
| **Forja** | `desenvolvimento` | Sistemas, APIs, deploy, automações técnicas. |
| **Sentinela** | `segurança` | Políticas de segurança, risco, compliance, acessos. |
| **Suporte** | `suporte` | Atendimento operacional, incidentes, SLAs. |

### Colaboração Intersetorial (Cross-Sector)
Quando um agente não possui a resposta em sua base local, ele pode consultar automaticamente outros agentes via **RabbitMQ**. 
- O usuário fala **apenas** com o agente do seu setor.
- Os agentes colaboram entre si nos bastidores seguindo protocolos rígidos.
- Informações classificadas como `confidential` ou `restricted` nunca cruzam a fronteira do setor original.

---

## 3. Funcionalidades Principais

### 3.1. Chat Seguro com RAG (Retrieval-Augmented Generation)
O chat não apenas gera texto, mas busca evidências em documentos reais.
- **Citações de Fontes:** Toda resposta baseada em documentos exibe a fonte original, permitindo validação humana.
- **Trilha de Delegacão:** Se a resposta veio de uma consulta a outro setor, o sistema exibe essa trajetória para o usuário.

### 3.2. Ingestão Curada e Staging
O processo de alimentação do conhecimento é rigoroso e evita a poluição da IA com dados incorretos.
1. **Upload:** Arquivos são enviados para um ambiente de *Staging*.
2. **Curadoria:** Especialistas revisam o conteúdo extraído, corrigem se necessário ou rejeitam documentos de baixa qualidade.
3. **Promoção (SOP):** Documentos aprovados são transformados em **Standard Operating Procedures (SOPs)** em Markdown e indexados na base produtiva.

### 3.3. Automação de Processos (Integração Forja)
O sistema permite disparar automações reais diretamente do chat.
- **Exemplos:** Criação de chamados no Cervello, pesquisas de preços de medicamentos, coleta de índices econômicos.
- **Fluxo de Aprovação:** Setores que não são donos da automação (ex: Suporte pedindo algo da Forja) exigem uma **justificativa curta** que é auditada antes da execução.

### 3.4. Painel Administrativo e Auditoria
Interface completa para gestores monitorarem o ecossistema:
- **Audit Log:** Visualização detalhada de todas as perguntas, respostas, latências e chamadas entre agentes.
- **Knowledge Graph:** Visualização visual das conexões entre documentos e tópicos de conhecimento.
- **Gaps de Conhecimento:** Identificação de perguntas que ficaram sem resposta para orientar a criação de novos documentos.

---

## 4. Como o Sistema Funciona (Workflows)

### Fluxo de uma Pergunta
1. **Pergunta do Usuário:** Enviada via interface Web.
2. **Busca Local:** O sistema procura no banco vetorial (**Qdrant**) do setor do usuário.
3. **Avaliação de Confiança:**
   - Se a confiança for alta: Responde direto.
   - Se for baixa/inexistente: Dispara consulta aos outros agentes.
4. **Consolidação:** O agente local recebe as contribuições, filtra o que é público/interno e gera a resposta final.
5. **Auditoria:** Toda a operação é persistida no **Postgres** para análise posterior.

### Fluxo de Ingestão de Documentos
1. Colaborador faz upload em `/files`.
2. Documento entra em "Review" no painel de Curadoria.
3. Curador verifica a extração e clica em "Promote".
4. O sistema gera um arquivo `.md` físico, gera novos embeddings e atualiza a base de conhecimento "viva".

---

## 5. Como Usar (Guia Rápido)

### Para Colaboradores (Consumo)
- Acesse o portal e faça login com suas credenciais setoriais.
- Use a barra de chat para perguntas diretas (ex: "Como configuro o acesso ao banco X?").
- Verifique as citações ao final da resposta para garantir a precisão.

### Para Donos de Conhecimento (Gestão)
- Utilize a aba **Files** para subir novos manuais ou políticas.
- Monitore o painel de **Curadoria** para validar contribuições de outros membros do time.
- Verifique periodicamente o **Knowledge Graph** para entender como os temas se conectam.

### Para Gestores e Auditores
- Acesse o painel **Admin > Audit** para extrair relatórios de uso e eficácia.
- Utilize o painel de **Feedback** para entender a satisfação dos usuários e identificar pontos cegos no conhecimento da empresa.

---

## 6. Roadmap e Futuro

O projeto segue um plano de evolução em fases:
- **Fase 0:** Estabilização e métricas iniciais.
- **Fase 1 (Atual):** Foco em loop de correção e fechamento de lacunas de conhecimento.
- **Fase 2:** Governança avançada, rerankers de precisão e controle de validade de documentos.
- **Fase 3:** Expansão para novos canais (ex: Microsoft Teams).

---
*Documento gerado para fins de planejamento de apresentação e disseminação do conhecimento do projeto PFRM Secure Agents.*
