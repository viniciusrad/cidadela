# Containers, homologacao e sustentacao

Este documento define o contrato inicial para rodar `cidadela-agents` em
desenvolvimento local e homologacao com infraestrutura intercambiavel. Ele nao
substitui runbooks do provedor, politicas de seguranca ou definicoes formais de
RPO/RTO da empresa.

## Artefatos de deploy

- `Dockerfile` tem targets `dev`, `builder`, `migrator` e `runner`.
- `runner` e a imagem standalone de runtime; inicia `node server.js` como
  usuario nao-root e nao executa migracao ou seed no boot.
- `migrator` e o target one-off que roda `prisma migrate deploy`.
- `docker-compose.yml` e a base de homologacao para a aplicacao e o migrator.
- `docker-compose.local.yml` sobe infraestrutura local e, sob profile, a app
  em container com hot reload.
- `homolog.env.example` descreve o contrato de ambiente de homologacao.

## Modelo de execucao

| Ambiente | App | Infraestrutura | Comando base |
| --- | --- | --- | --- |
| Dev no host | `npm run dev` | `docker-compose.local.yml` | `docker compose -f docker-compose.local.yml --profile cpu up -d` |
| Dev em container | target `dev` | `docker-compose.local.yml` | `docker compose -f docker-compose.local.yml --profile cpu --profile container-app up -d --build app` |
| Homologacao | target `runner` | endpoints injetados | `docker compose --env-file homolog.env up -d app` |

O Compose de homologacao nao sobe bancos locais. Trocar Postgres, Qdrant,
RabbitMQ, Neo4j ou Ollama e uma mudanca de endpoint/credencial no ambiente,
desde que a rede do container alcance o destino e o servico preserve o contrato
de protocolo esperado.

## Desenvolvimento local

### App no host

1. Copie `.env.local.example` para `.env.local`.
2. Suba a infraestrutura local.
3. Instale dependencias, migre e aplique seeds controlados.
4. Inicie o Next.js no host.

```bash
docker compose -f docker-compose.local.yml --profile cpu up -d
npm install
npm run db:migrate
npm run seed
npm run seed:sectors
npm run dev
```

Use `--profile gpu` no lugar de `--profile cpu` quando o host estiver preparado
para o container Ollama com GPU. O profile `cpu` ou `gpu` controla apenas
Ollama; Postgres, Qdrant, RabbitMQ e Neo4j sobem sem profile.

### App em container

O target `dev` monta o repositorio, preserva `node_modules` e `.next` em
volumes e ativa polling para HMR. A migracao continua sendo one-off.

```bash
docker compose -f docker-compose.local.yml --profile ops run --rm migrate
docker compose -f docker-compose.local.yml --profile cpu --profile container-app up -d --build app
```

Seeds nao rodam no boot do container. Rode-os pelo host ou por um job aprovado
quando a base local precisar de dados de referencia.

#### Atualizacao da app local

Nao use `docker compose up --build -d` sem `-f docker-compose.local.yml` para
atualizar o ambiente local. O Compose da raiz e o contrato de homologacao e
exige os endpoints externos daquele ambiente.

Para mudancas apenas de codigo, o bind mount em `/app` entrega os arquivos ao
`next dev`; aguarde o hot reload e atualize o navegador. Se o processo dev
continuar servindo a compilacao anterior, reinicie somente a app local:

```bash
docker compose -f docker-compose.local.yml --profile container-app restart app
```

Quando `Dockerfile`, `docker-compose.local.yml` ou a imagem dev mudarem,
reconstrua o servico local explicitamente:

```bash
docker compose -f docker-compose.local.yml --profile cpu --profile container-app up -d --build app
```

Se `package.json` ou `package-lock.json` mudarem em uma app local que ja tem o
volume `app_node_modules`, atualize esse volume antes da validacao:

```bash
docker compose -f docker-compose.local.yml --profile container-app run --rm --no-deps app npm install
docker compose -f docker-compose.local.yml --profile container-app restart app
```

## Homologacao

### Preparacao

1. Gere uma imagem a partir do commit aprovado.
2. Copie `homolog.env.example` para um arquivo protegido fora do repositorio.
3. Substitua placeholders por endpoints reais e segredos vindos do secret
   manager.
4. Garanta conectividade da rede do container para Postgres, Qdrant, RabbitMQ,
   Neo4j, Ollama e integracoes HTTP que estiverem habilitadas.
5. Monte ou preserve o volume `/app/files` para artefatos curados.

Variaveis obrigatorias pelo Compose base:

- `AUTH_SECRET`
- `NEXTAUTH_URL`
- `DATABASE_URL`
- `QDRANT_URL`
- `OLLAMA_URL`
- `RABBITMQ_URL`
- `NEO4J_URI`
- `NEO4J_PASSWORD`

`QDRANT_API_KEY` e opcional para Qdrant local e necessario quando o endpoint
vetorial exigir autenticacao. URLs TLS podem ser usadas nos campos de Postgres,
RabbitMQ e Neo4j conforme o provedor.

### Deploy

```bash
docker compose --env-file homolog.env build app migrate
docker compose --env-file homolog.env --profile ops run --rm migrate
docker compose --env-file homolog.env up -d app
```

Nao acople `prisma migrate deploy`, `seed` ou ingestao ao comando de boot da
app. Migrations devem falhar de forma visivel antes da promocao da nova imagem.
Seeds devem ter aprovacao operacional porque criam usuarios e dados de
referencia.

### Probes e smoke

- `GET /api/health/live` mede liveness do processo Next.js e e usado pelo
  healthcheck da imagem.
- `GET /api/health` consulta Postgres, Qdrant, Ollama, RabbitMQ e Neo4j e
  retorna `ok` ou `degraded` no payload.
- Verifique login, uma conversa sem delegacao, uma delegacao setorial e uma
  consulta de curadoria antes de liberar homologacao para uso.

Se `/api/health/live` falhar, investigue a imagem/processo. Se `/api/health`
retornar `degraded`, investigue primeiro endpoint, DNS, TLS, credencial e
firewall do store indicado.

## Persistencia e segredos

| Dado | Dono | Persistencia esperada |
| --- | --- | --- |
| Conversas, usuarios, auditoria, curadoria e configuracao | Postgres | Servico persistente com backup transacional |
| Chunks produtivos e staging vetorial | Qdrant | Colecoes persistentes e snapshots |
| Delegacao agente-a-agente | RabbitMQ | Broker duravel e definicoes versionadas/runbook |
| Grafo de conhecimento | Neo4j | Banco persistente e dump/backup testado |
| Artefatos SOP e curados | `/app/files` | Volume ou object storage sincronizado |
| Modelos | Ollama/provedor | Cache controlado e versoes conhecidas |

Segredos nao devem estar no Compose versionado. Minimo esperado:

- rotacionar `AUTH_SECRET`, credenciais de stores e tokens internos por
  processo aprovado;
- nao publicar portas administrativas de bancos para redes de usuario;
- aplicar TLS onde o store sai do host/rede privada;
- restringir permissao de leitura do arquivo de ambiente e dos backups.

## Backup e recuperacao

### Direcionamento por store

| Store | Backup minimo para homologacao | Recuperacao esperada |
| --- | --- | --- |
| Postgres | dump logico antes de migration critica; snapshots/base backup e WAL/PITR quando o provedor suportar | restaurar banco, validar migrations aplicadas e conferir auditoria/usuarios |
| Qdrant | snapshots das colecoes `rag_*` e `rag_*_staging` ou backup gerenciado equivalente | restaurar colecoes e validar contagem/consulta vetorial por setor |
| Neo4j | dump offline na Community ou backup do servico gerenciado | restaurar banco, validar `Document`/relacoes e conectividade Bolt |
| RabbitMQ | definicoes, politicas, usuarios/vhosts e politica para mensagens duraveis | restaurar topologia antes de reabrir trafego e validar RPC entre agentes |
| `/app/files` | copia consistente dos artefatos `sop/` e `curated/` | restaurar junto com Postgres para manter `sopPath` resolvivel |

Postgres, artefatos de arquivo e colecoes vetoriais precisam ser tratados como
um conjunto para curadoria. Restaurar somente um deles pode deixar caminhos,
citacoes ou chunks divergentes do estado aprovado.

### Ordem de restore sugerida

1. Restaurar segredos, DNS, certificados e regras de rede do ambiente.
2. Restaurar Postgres e o volume/object storage de `/app/files`.
3. Restaurar Qdrant e Neo4j a partir do ponto compativel com o banco
   relacional.
4. Restaurar RabbitMQ e sua topologia antes de liberar delegacoes.
5. Rodar `migrate` somente se a imagem restaurada exigir migrations pendentes.
6. Subir a app, executar probes e smoke tests por setor.
7. Registrar versao de imagem, pontos de backup usados e resultado do teste.

### Pendencias para o runbook definitivo

- Definir RPO/RTO por store e janela de retencao.
- Definir onde backups criptografados ficam armazenados e quem restaura.
- Automatizar teste periodico de restore em ambiente isolado.
- Decidir se RabbitMQ em homologacao precisa preservar mensagens em voo ou se
  a recuperacao aceitara reexecucao controlada.
- Definir estrategia de rebuild vetorial/grafo quando snapshots forem
  incompativeis com a versao alvo.

## Checklist de sustentacao

- Usar imagem imutavel por tag/digest aprovado.
- Rodar migration como job one-off e observar falhas antes de trocar trafego.
- Monitorar logs da app, probes, conexoes aos stores, latencia de Ollama e
  tempo de RPC no bus.
- Verificar capacidade e retencao de Postgres, Qdrant, Neo4j e volumes de
  artefatos.
- Revisar variaveis do `homolog.env.example` quando novas integracoes entrarem.
- Testar restore antes de chamar o ambiente de recuperavel.
