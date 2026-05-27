import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

import type { HealthStatus } from "@/lib/dashboard/metrics";

type Pill = {
  key: keyof HealthStatus;
  label: string;
  description: string;
};

const PILLS: Pill[] = [
  { key: "postgres", label: "Postgres", description: "Banco transacional" },
  { key: "qdrant", label: "Qdrant", description: "Banco vetorial" },
  { key: "ollama", label: "Ollama", description: "Modelos locais" },
  { key: "rabbitmq", label: "RabbitMQ", description: "Bus de agentes" },
  { key: "neo4j", label: "Neo4j", description: "Grafo de conhecimento" },
];

export function DashboardHealthStrip({ health }: { health: HealthStatus | null }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-black uppercase tracking-[0.22em] text-[var(--muted)]">
          Saude dos servicos
        </h3>
        {health === null && (
          <p className="text-[11px] text-[var(--muted)]">
            Indicadores indisponiveis no momento.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {PILLS.map((pill) => {
          const status = health?.[pill.key];
          const ok = status === true;
          const unknown = health === null;

          const accent = unknown
            ? "border-[var(--border)] bg-white text-[var(--foreground-soft)]"
            : ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800";

          return (
            <div
              className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 ${accent}`}
              key={pill.key}
            >
              <span className="shrink-0">
                {unknown ? (
                  <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                ) : ok ? (
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <XCircle aria-hidden="true" className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-black uppercase tracking-wide">
                  {pill.label}
                </p>
                <p className="truncate text-[10px] leading-tight opacity-80">
                  {unknown ? pill.description : ok ? "Operacional" : "Indisponivel"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
