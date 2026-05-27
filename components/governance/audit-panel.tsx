import { prisma } from "@/lib/db/client";
import { getSectorLabel } from "@/lib/labels";

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function statusLabel(status: string) {
  if (status === "ok") return "concluido";
  if (status === "timeout") return "sem resposta no prazo";
  if (status === "bus_unavailable") return "barramento indisponivel";
  if (status === "protocol_violation") return "fora do protocolo";
  return status;
}

function technicalJson(value: unknown) {
  return JSON.stringify(value ?? null, null, 2);
}

export async function AuditPanel() {
  const [agentCalls, auditEvents] = await Promise.all([
    prisma.agentCall.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const timelineEntries = [
    ...agentCalls.map((call) => ({
      id: `call:${call.id}`,
      createdAt: call.createdAt,
      eyebrow: "Encaminhamento entre agentes",
      title: `${getSectorLabel(call.fromAgent)} consultou ${getSectorLabel(call.toAgent)}`,
      summary: `Assunto: ${call.intent}. Resultado: ${statusLabel(call.status)}${
        typeof call.latencyMs === "number" ? ` em ${(call.latencyMs / 1000).toFixed(1)}s` : ""
      }.`,
      details: {
        traceId: call.traceId,
        parentTraceId: call.parentTraceId,
        protocol: call.protocol,
        request: call.request,
        response: call.response,
      },
    })),
    ...auditEvents.map((event) => ({
      id: `event:${event.id}`,
      createdAt: event.createdAt,
      eyebrow: "Registro de operacao",
      title: `${event.actorType} atualizou ${event.targetType}`,
      summary: `Evento: ${event.eventType}. Alvo: ${event.targetId}.`,
      details: {
        traceId: event.traceId,
        actorType: event.actorType,
        actorId: event.actorId,
        targetType: event.targetType,
        targetId: event.targetId,
        eventType: event.eventType,
        payload: event.payload,
      },
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <section className="premium-panel rounded-[2rem] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Linha do tempo
          </p>
          <h2 className="mt-2 text-xl font-black text-[var(--foreground-strong)]">
            Ultimos registros da operacao
          </h2>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--foreground-soft)]">
          <span className="rounded-full border border-[var(--border)] bg-white px-3 py-1">
            {agentCalls.length} encaminhamentos
          </span>
          <span className="rounded-full border border-[var(--border)] bg-white px-3 py-1">
            {auditEvents.length} registros
          </span>
        </div>
      </div>

      <ol className="mt-6 space-y-3">
        {timelineEntries.map((entry) => (
          <li
            className="rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"
            key={entry.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  {formatDateTime(entry.createdAt)} | {entry.eyebrow}
                </p>
                <p className="mt-2 text-sm font-bold text-[var(--foreground-strong)]">
                  {entry.title}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--foreground-soft)]">
                  {entry.summary}
                </p>
              </div>
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
                Ver detalhes tecnicos
              </summary>
              <pre className="mt-3 max-h-80 overflow-auto rounded-2xl border border-[var(--border)] bg-white p-3 text-[11px] leading-5 text-[var(--foreground-soft)]">
                {technicalJson(entry.details)}
              </pre>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
