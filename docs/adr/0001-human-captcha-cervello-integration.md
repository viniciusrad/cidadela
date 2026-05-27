# ADR 0001: Integracao com human-in-captcha para automacoes internas

## Status

Aceita.

## Contexto

O `pfrm-secure-agents` precisa permitir que uma mensagem do chat acione automacoes operacionais, mas a execucao real ja pertence ao projeto `human-in-captcha`.

## Decisao

O `pfrm-secure-agents` nao replica as automacoes. Ele detecta apenas comandos explicitos do setor `desenvolvimento`, chama uma API HTTP interna do `human-in-captcha` e apresenta ao usuario os links da execucao.

A comunicacao acontece por uma rede Docker externa local compartilhada. O contrato usa bearer token interno e `Idempotency-Key`; o `human-in-captcha` permanece dono da fila BullMQ, do worker Playwright, do noVNC e do estado da execucao.

Quando a solicitacao parte de `seguranca` ou `suporte`, o chat nao enfileira imediatamente. Ele registra `automation.approval_requested`, pede confirmacao com motivo curto e so chama o `human-in-captcha` depois de uma resposta confirmatoria no formato `sim, motivo: ...`.

As automacoes permitidas por essa integracao sao:

- `problemas-pedido-eletronico`: abertura de chamado Cervello.
- `medication-price-survey`: pesquisa de precos de medicamentos.
- `coleta-indices-moedas`: coleta de indices e moedas.

## Consequencias

- Nao ha compartilhamento de banco, Redis ou RabbitMQ entre os sistemas.
- O endpoint de scripts do `human-in-captcha` aceita somente as chaves liberadas para essa integracao.
- Falhas no servico de automacao retornam erro explicito no chat e geram auditoria `automation.failed`.
- A idempotencia evita duplicar runs quando a mesma mensagem do chat for reenviada.
- Pedidos cross-agent ficam auditados com setor solicitante, dono da automacao e motivo informado pelo usuario.
