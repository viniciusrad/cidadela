## PFRM Secure Agents

Continuacao de `pfrm-chat` em um componente irmao voltado a producao. Este app acrescenta autenticacao por credenciais, isolamento por setor, persistencia SQL, auditoria e delegacao entre agentes via RabbitMQ sem alterar o MVP original.

### Stack

- Next.js 16
- Auth.js Credentials
- Prisma + Postgres
- Qdrant por setor
- RabbitMQ para agente-agente
- Ollama local para embeddings e respostas

### Portas locais

- App: `http://localhost:3030`
- Postgres: `5544`
- Qdrant: `6433`
- RabbitMQ AMQP: `5673`
- RabbitMQ UI: `15673`
- Ollama: `11500`

### Setup

1. Copie `.env.local.example` para `.env.local`.
2. Suba a infraestrutura local com `docker compose -f docker-compose.local.yml --profile cpu up -d`.
3. Rode `npm install`.
4. Rode `npx prisma migrate dev --name init`.
5. Rode `npm run seed`.
6. Rode `npm run seed:sectors`.
7. Rode `npm run dev`.

O arquivo `docker-compose.local.yml` cria a rede local `pfrm-local-internal`
usada pelas integracoes Docker locais. Para rodar tambem a aplicacao com hot
reload dentro de container, ative o profile `container-app` e rode a migracao
one-off do profile `ops` antes do primeiro uso.

```bash
docker compose -f docker-compose.local.yml --profile ops run --rm migrate
docker compose -f docker-compose.local.yml --profile cpu --profile container-app up -d --build app
```

### Execucao local completa em Docker

O Compose local precisa ser informado explicitamente. Neste repositorio,
`docker compose ...` sem `-f docker-compose.local.yml` usa o
`docker-compose.yml` da raiz, que e a base de homologacao e exige endpoints e
segredos externos.

Mudancas apenas de codigo entram pelo bind mount do servico local, que roda
`next dev` com hot reload. Se a tela continuar antiga depois de atualizar o
navegador, reinicie somente a app local:

```bash
docker compose -f docker-compose.local.yml --profile container-app restart app
```

**Rebuild da app local para mudancas de imagem ou configuracao:**

```bash
docker compose -f docker-compose.local.yml --profile cpu --profile container-app up -d --build app
```

**Rebuild com recriacao explicita do container da app:**

```bash
docker compose -f docker-compose.local.yml --profile cpu --profile container-app up -d --build --force-recreate app
docker compose -f docker-compose.local.yml --profile container-app up -d --build --force-recreate app


ou

docker compose build --no-cache app && docker compose up -d app
```

Este e o fluxo equivalente ao ambiente local em container: aplicacao Next.js
em modo dev com hot reload, Postgres, Qdrant, RabbitMQ, Neo4j e Ollama CPU.

Se `package.json` ou `package-lock.json` mudarem em uma app local ja criada,
atualize tambem o volume de dependencias antes de validar:

```bash
docker compose -f docker-compose.local.yml --profile container-app run --rm --no-deps app npm install
docker compose -f docker-compose.local.yml --profile container-app restart app
```

Na primeira subida depois de alterar o `Dockerfile` ou o Compose local, use
`--build` para evitar que o Docker reaproveite uma imagem antiga da app:

```bash
docker compose -f docker-compose.local.yml --profile cpu --profile container-app up -d --build
```

Nas proximas subidas, quando a imagem local ja estiver atualizada:

```bash
docker compose -f docker-compose.local.yml --profile cpu --profile container-app up -d
```

A aplicacao fica em `http://localhost:3030`.

Migrations sao operacoes one-off e nao rodam no boot da app:

```bash
docker compose -f docker-compose.local.yml --profile ops run --rm migrate
```

Quando a base local precisar dos dados de referencia:

```bash
npm run seed
npm run seed:sectors
```

Para acompanhar logs da aplicacao:

```bash
docker compose -f docker-compose.local.yml --profile cpu --profile container-app logs -f app
```

Para parar o ambiente local sem remover volumes:

```bash
docker compose -f docker-compose.local.yml --profile cpu --profile container-app down
```

`pfrm-local-internal` e uma rede Docker externa compartilhada pelas integracoes
locais. Se ela ainda nao existir no host, crie uma vez antes da subida:

```bash
docker network create pfrm-local-internal
```

### Containers e homologacao

`docker-compose.yml` e a base de homologacao: ele sobe a imagem standalone da
aplicacao e recebe Postgres, Qdrant, RabbitMQ, Neo4j e Ollama por variaveis.
Ele nao inicia bancos locais nem executa seed a cada boot. O procedimento de
deploy, migracao, persistencia, backup e restore esta em `DEPLOYMENT.md`; o
arquivo `homolog.env.example` lista o contrato de variaveis.

### Integracao com automacoes

Para acionar automacoes do `human-in-captcha` a partir do chat, configure `HUMAN_CAPTCHA_API_URL` e `HUMAN_CAPTCHA_INTERNAL_TOKEN` com os mesmos valores usados no compose/API do `human-in-captcha`. Em containers, o endpoint padrao e `http://human-automation-api:3001`.

O agente de desenvolvimento dispara hoje:

- `problemas-pedido-eletronico`: criar chamado Cervello para Pedido Eletronico.
- `medication-price-survey`: gerar relatorio de precos de medicamentos.
- `coleta-indices-moedas`: coletar indices e cotacoes de moedas.

Agentes de outros setores podem solicitar as mesmas automacoes, mas o chat pede confirmacao com motivo curto antes de enfileirar. Exemplo: `sim, motivo: incidente reportado pelo time de pedidos`.

### Usando Ollama Nativo (Host Mode)

Para rodar usando o Ollama instalado na sua máquina (sem usar o container):

1. No arquivo `.env.local`, altere para `OLLAMA_HOST_MODE=true`
2. Para baixar os modelos nativamente, use: `powershell -ExecutionPolicy Bypass -File scripts/bootstrap-models.ps1 -HostMode`

### Usuarios de referencia

- `dev@pfrm.local` / `dev123`
- `sec@pfrm.local` / `sec123`
- `suporte@pfrm.local` / `sup123`
- `admin@pfrm.local` / `admin123`

### Smoke

- `npm run demo` valida uma pergunta do setor de desenvolvimento que delega para seguranca.

## comandos uteis

Listar colecoes Qdrant:
(Invoke-RestMethod http://localhost:6433/collections).result.collections

Listar filas RabbitMQ:
Get-AmqpQueue -Vhost "/" | Select Name

esquema do banco postgres
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public';

resumo do schema
npx prisma db info

show collections neo4j:
MATCH (n) RETURN DISTINCT labels(n)
MATCH ()-[r]->() RETURN DISTINCT type(r)

## Troubleshooting

### Watchpack ENOMEM no container em modo dev

**Sintoma:** Vários erros no console do container ao rodar `npm run dev`:
```
Watchpack Error (initial scan): Error: ENOMEM: not enough memory, scandir '/app/app/api/...'
```

**Causa:** O kernel Linux (WSL2) tem um limite baixo de `inotify watches` por usuário (padrão: 8.192). O Next.js em modo dev registra um watch por diretório via Watchpack. Um projeto com muitas rotas de API estoura esse limite. O erro `ENOMEM` é o kernel indicando que o limite foi atingido, não que a RAM acabou.

**Solução permanente — aplicar no host WSL2 (não no container):**
```bash
sudo sysctl -w fs.inotify.max_user_watches=524288
sudo sysctl -w fs.inotify.max_user_instances=512
# Para persistir entre reinicializações do WSL2:
echo "fs.inotify.max_user_watches=524288" | sudo tee -a /etc/sysctl.conf
echo "fs.inotify.max_user_instances=512" | sudo tee -a /etc/sysctl.conf
```

**Alternativa imediata sem reiniciar WSL2:** rodar a app em modo de produção dentro do container elimina o Watchpack por completo:
```bash
npm run build && npm start
```
