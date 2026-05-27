import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ClipboardCheck, MessageSquareWarning } from "lucide-react";

import { auth } from "@/auth";
import { SecureAppShell } from "@/components/secure-app-shell";
import { loadPendencyOverviewForActor } from "@/lib/notifications/pendencies";
import { SECTOR_LABELS } from "@/lib/labels";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function PendenciasPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
  };

  const overview = await loadPendencyOverviewForActor(user);

  return (
    <SecureAppShell
      currentPage="pendencies"
      description="Itens que precisam da sua acao como dono ou revisor de conhecimento."
      title="Minhas pendencias"
      user={user}
    >
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Lacunas
          </p>
          <p className="mt-2 text-2xl font-black text-[var(--foreground-strong)]">
            {overview.counts.gaps}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Correcoes
          </p>
          <p className="mt-2 text-2xl font-black text-[var(--foreground-strong)]">
            {overview.counts.corrections}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Sem resposta
          </p>
          <p className="mt-2 text-2xl font-black text-[var(--foreground-strong)]">
            {overview.counts.unanswered}
          </p>
        </div>
      </section>

      {overview.counts.total === 0 ? (
        <section className="premium-panel rounded-lg p-6">
          <p className="text-sm text-[var(--foreground-soft)]">
            Nenhuma pendencia encontrada para os topicos sob sua responsabilidade.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          <section className="premium-panel rounded-lg p-5">
            <div className="flex items-center gap-3">
              <ClipboardCheck aria-hidden="true" className="h-5 w-5 text-[var(--accent)]" />
              <h2 className="text-lg font-black text-[var(--foreground-strong)]">
                Lacunas de processo
              </h2>
            </div>
            <div className="mt-4 space-y-3">
              {overview.gaps.length === 0 ? (
                <p className="text-sm text-[var(--foreground-soft)]">
                  Sem lacunas promovidas para seus topicos.
                </p>
              ) : (
                overview.gaps.map((gap) => (
                  <article
                    className="rounded-lg border border-[var(--border)] bg-white p-4"
                    key={gap.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                          {SECTOR_LABELS[gap.sector as keyof typeof SECTOR_LABELS] ?? gap.sector} / {gap.processName}
                        </p>
                        <h3 className="mt-1 font-black text-[var(--foreground-strong)]">
                          {gap.question}
                        </h3>
                        <p className="mt-2 text-sm text-[var(--foreground-soft)]">
                          {gap.rationale}
                        </p>
                      </div>
                      <Link
                        className="rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-black text-white"
                        href={gap.href}
                      >
                        Abrir
                      </Link>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="premium-panel rounded-lg p-5">
            <div className="flex items-center gap-3">
              <MessageSquareWarning aria-hidden="true" className="h-5 w-5 text-[var(--accent)]" />
              <h2 className="text-lg font-black text-[var(--foreground-strong)]">
                Correcoes pendentes
              </h2>
            </div>
            <div className="mt-4 space-y-3">
              {overview.corrections.length === 0 ? (
                <p className="text-sm text-[var(--foreground-soft)]">
                  Sem correcoes aguardando revisao.
                </p>
              ) : (
                overview.corrections.map((correction) => (
                  <article
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-white p-4"
                    key={correction.id}
                  >
                    <p className="text-sm text-[var(--foreground-soft)]">
                      Documento {correction.documentId}, trecho #{correction.chunkIndex} em{" "}
                      {SECTOR_LABELS[correction.sector as keyof typeof SECTOR_LABELS] ?? correction.sector}.{" "}
                      Criada em {formatDate(correction.createdAt)}.
                    </p>
                    <Link
                      className="rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-black text-white"
                      href={correction.href}
                    >
                      Revisar
                    </Link>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="premium-panel rounded-lg p-5">
            <div className="flex items-center gap-3">
              <AlertCircle aria-hidden="true" className="h-5 w-5 text-[var(--accent)]" />
              <h2 className="text-lg font-black text-[var(--foreground-strong)]">
                Perguntas sem resposta
              </h2>
            </div>
            <div className="mt-4 space-y-3">
              {overview.unanswered.length === 0 ? (
                <p className="text-sm text-[var(--foreground-soft)]">
                  Sem perguntas sem resposta nos ultimos 7 dias.
                </p>
              ) : (
                overview.unanswered.map((item) => (
                  <article
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-white p-4"
                    key={item.id}
                  >
                    <p className="text-sm text-[var(--foreground-soft)]">
                      {item.question} ({formatDate(item.createdAt)})
                    </p>
                    <Link
                      className="rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-black text-white"
                      href={item.href}
                    >
                      Ver feedback
                    </Link>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </SecureAppShell>
  );
}
