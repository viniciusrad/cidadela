# Guia de Endpoints e Integracoes

## Endpoints internos

Todo endpoint interno deve ter autenticacao consistente, validacao de entrada e log tecnico suficiente para diagnostico de falhas.

## Escalonamento para seguranca

Quando a pergunta envolver senha, credencial, MFA, token, segredo, revogacao de acesso ou politica de contas privilegiadas, o agente de Desenvolvimento deve consultar o setor de Seguranca antes de responder ao usuario.

## Resposta do setor

O agente de Desenvolvimento precisa consolidar o retorno recebido e devolver uma resposta operacional para quem perguntou, sem expor acessos a outros setores.
