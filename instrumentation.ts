export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (process.env.BUS_BOOTSTRAP_ENABLED === "false") {
    return;
  }

  try {
    const { ensureBusBootstrapped } = await import("@/lib/bus/bootstrap");
    await ensureBusBootstrapped();
  } catch (error) {
    console.warn(
      "[instrumentation] Falha ao iniciar consumidores de agentes:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const { ensureContentIndexesForAllSectors } = await import("@/lib/qdrant");
    await ensureContentIndexesForAllSectors();
  } catch (error) {
    console.warn(
      "[instrumentation] Falha ao criar indice de texto no Qdrant:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const { startNotificationSchedules } = await import(
      "@/lib/notifications/scheduler"
    );
    startNotificationSchedules();
  } catch (error) {
    console.warn(
      "[instrumentation] Falha ao iniciar rotinas de notificacao:",
      error instanceof Error ? error.message : error,
    );
  }
}
