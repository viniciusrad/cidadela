import { appConfig } from "../lib/config";
import { startChatConsumer } from "../lib/bus/chat-queue";
import { getBusConnection } from "../lib/bus/connection";

// Worker dedicado da Fase 2 (docs/allByQueue.md). Roda o consumidor de
// `chat.requests` em um processo separado do Next.js, de modo que picos de
// produtores HTTP nao disputem o event loop com a geracao do Ollama. Tambem
// elimina a divida de "bootstrap no trafego": aqui o consumidor sobe no start
// do processo, nao no primeiro request.
//
// Pre-requisito de deduplicacao: o app Next.js so deve PARAR de iniciar o
// consumidor in-process quando `CHAT_WORKER_EXTERNAL=true` (ver
// lib/bus/bootstrap.ts). Sem isso, app e worker consumiriam `chat.requests`
// simultaneamente.

async function main() {
  if (!appConfig.chatQueueEnabled) {
    console.error(
      "[chat-worker] CHAT_QUEUE_ENABLED=false — nao ha o que consumir. Defina CHAT_QUEUE_ENABLED=true para usar o worker dedicado.",
    );
    process.exit(1);
  }

  if (!appConfig.chatWorkerExternal) {
    console.warn(
      "[chat-worker] CHAT_WORKER_EXTERNAL nao esta 'true'. O app Next.js tambem iniciara o consumidor in-process, criando DOIS consumidores concorrentes em chat.requests. Defina CHAT_WORKER_EXTERNAL=true no ambiente do app para evitar duplicidade.",
    );
  }

  console.log(
    "[chat-worker] iniciando consumidor dedicado de chat.requests (concurrency=%d, timeout=%dms, flush=%dms)",
    appConfig.chatQueueConcurrency,
    appConfig.chatQueueTimeoutMs,
    appConfig.chatQueueChunkFlushMs,
  );

  // startChatConsumer faz assert idempotente da topologia `chat.direct` +
  // `chat.requests` e registra o consumidor. A conexao amqplib mantem o socket
  // aberto, entao o event loop nao encerra e o processo permanece vivo.
  await startChatConsumer();

  console.log(
    "[chat-worker] pronto. Aguardando jobs de geracao em chat.requests...",
  );
}

async function shutdown(signal: string) {
  console.log("[chat-worker] recebido %s, encerrando conexao do bus...", signal);
  try {
    const connection = await getBusConnection();
    await connection.close();
  } catch (error) {
    console.warn(
      "[chat-worker] falha ao fechar conexao do bus:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((error) => {
  console.error(
    "[chat-worker] falha fatal ao iniciar:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
