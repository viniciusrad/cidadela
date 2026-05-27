import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";

import type { ActivityEvent } from "@/lib/dashboard/metrics";

const EVENT_LABELS: Record<string, string> = {
  "automation.approval_requested": "Aprovacao de automacao solicitada",
  "automation.approval_confirmed": "Automacao aprovada",
  "automation.approval_cancelled": "Automacao cancelada",
  "protocol_config.reset": "Protocolo restaurado",
  "protocol_config.updated": "Protocolo atualizado",
  "user.feedback": "Feedback de usuario",
  "agent.unanswered": "Pergunta sem resposta",
  "document.promoted": "Documento promovido",
  "document.approved": "Documento aprovado",
  "document.rejected": "Documento rejeitado",
};

function humanize(eventType: string): string {
  if (EVENT_LABELS[eventType]) {
    return EVENT_LABELS[eventType];
  }
  return eventType.replace(/[._]/g, " ");
}

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function DashboardActivityFeed({ events }: { events: ActivityEvent[] | null }) {
  if (events === null) {
    return null;
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-black uppercase tracking-[0.22em] text-[var(--muted)]">
          Atividade recente
        </h3>
        <Link
          className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-[var(--accent-strong)] hover:underline"
          href="/admin/audit"
        >
          Ver historico
          <ArrowRight aria-hidden="true" className="h-3 w-3" />
        </Link>
      </div>

      <div className="rounded-[1.75rem] border border-[var(--border)] bg-white">
        {events.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[var(--foreground-soft)]">
            Sem registros recentes. Quando agentes encaminharem perguntas ou
            curadores aprovarem documentos, os eventos aparecerao aqui.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {events.map((event) => (
              <li className="flex items-start gap-3 px-5 py-3.5" key={event.id}>
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                  <Activity aria-hidden="true" className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-[var(--foreground-strong)]">
                    {humanize(event.eventType)}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--foreground-soft)]">
                    {event.actorType} / {event.actorId} sobre {event.targetType}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  {formatTimestamp(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
