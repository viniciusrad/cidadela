import Link from "next/link";

import { KpiCard } from "@/components/admin-kpi-card";
import {
  handleApproveCorrection,
  handleRejectCorrection,
} from "@/app/admin/corrections/actions";
import { prisma } from "@/lib/db/client";
import type { Sector } from "@/lib/domain";
import { SECTOR_LABELS } from "@/lib/labels";

type StatusFilter = "all" | "PENDING" | "APPROVED" | "REJECTED";
type CitationSnapshot = {
  sector?: unknown;
  documentId?: unknown;
  chunkIndex?: unknown;
  documentTitle?: unknown;
  fileName?: unknown;
  headingPathText?: unknown;
};

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Todas",
  PENDING: "Pendentes",
  APPROVED: "Aprovadas",
  REJECTED: "Rejeitadas",
};

function parseStatus(value: string | undefined): StatusFilter {
  if (value === "PENDING" || value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return "all";
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function statusClass(status: string) {
  if (status === "APPROVED") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (status === "REJECTED") {
    return "bg-rose-100 text-rose-700";
  }

  return "bg-amber-100 text-amber-700";
}

function findCitationSnapshot(
  citations: unknown,
  feedback: { sector: string; documentId: string; chunkIndex: number },
) {
  if (!Array.isArray(citations)) {
    return null;
  }

  const citation = citations.find((item): item is CitationSnapshot => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const maybeCitation = item as CitationSnapshot;
    return (
      maybeCitation.sector === feedback.sector &&
      maybeCitation.documentId === feedback.documentId &&
      maybeCitation.chunkIndex === feedback.chunkIndex
    );
  });

  return citation ?? null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function buildHref(status: StatusFilter) {
  if (status === "all") {
    return "/admin/governance?tab=corrections";
  }
  return `/admin/governance?tab=corrections&status=${status}`;
}

export async function CorrectionsPanel({
  searchParams,
  reviewSectors,
}: {
  searchParams: { status?: string };
  reviewSectors: Sector[];
}) {
  const selectedStatus = parseStatus(searchParams.status);

  const where = {
    sector: { in: reviewSectors },
    ...(selectedStatus === "all" ? {} : { status: selectedStatus }),
  };

  const [feedbacks, statusCounts] = await Promise.all([
    prisma.chunkFeedback.findMany({
      where,
      include: {
        user: {
          select: { email: true, name: true },
        },
        reviewer: {
          select: { email: true, name: true },
        },
        message: {
          include: {
            conversation: {
              include: {
                user: {
                  select: { email: true, name: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.chunkFeedback.groupBy({
      by: ["status"],
      where: { sector: { in: reviewSectors } },
      _count: true,
    }),
  ]);

  const documentIds = Array.from(
    new Set(feedbacks.map((feedback) => feedback.documentId)),
  );
  const traceIds = Array.from(
    new Set(feedbacks.map((feedback) => feedback.message.traceId)),
  );

  const [documents, userMessages] =
    documentIds.length === 0 && traceIds.length === 0
      ? [[], []]
      : await Promise.all([
          documentIds.length === 0
            ? []
            : prisma.curationDocument.findMany({
                where: {
                  sector: { in: reviewSectors },
                  OR: [
                    { documentId: { in: documentIds } },
                    { sourceDocumentId: { in: documentIds } },
                  ],
                },
                select: {
                  documentId: true,
                  sourceDocumentId: true,
                  documentTitle: true,
                  owner: true,
                  sector: true,
                  status: true,
                  topic: true,
                },
              }),
          traceIds.length === 0
            ? []
            : prisma.message.findMany({
                where: {
                  traceId: { in: traceIds },
                  role: "user",
                },
                orderBy: { createdAt: "asc" },
              }),
        ]);

  const documentByKey = new Map<string, (typeof documents)[number]>();
  for (const document of documents) {
    documentByKey.set(`${document.sector}:${document.documentId}`, document);
    documentByKey.set(
      `${document.sector}:${document.sourceDocumentId}`,
      document,
    );
  }

  const userMessageByTrace = new Map<string, (typeof userMessages)[number]>();
  for (const message of userMessages) {
    if (!userMessageByTrace.has(message.traceId)) {
      userMessageByTrace.set(message.traceId, message);
    }
  }

  const counts = new Map(
    statusCounts.map((item) => [item.status, item._count]),
  );
  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

  const filters: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: "all", label: STATUS_LABELS.all, count: total },
    { key: "PENDING", label: STATUS_LABELS.PENDING, count: counts.get("PENDING") ?? 0 },
    {
      key: "APPROVED",
      label: STATUS_LABELS.APPROVED,
      count: counts.get("APPROVED") ?? 0,
    },
    {
      key: "REJECTED",
      label: STATUS_LABELS.REJECTED,
      count: counts.get("REJECTED") ?? 0,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total de Sugestões" value={total} />
        <KpiCard
          label="Pendentes de Revisão"
          tone="alert"
          value={counts.get("PENDING") ?? 0}
        />
        <KpiCard
          label="Aprovações Aplicadas"
          tone="success"
          value={counts.get("APPROVED") ?? 0}
        />
        <KpiCard label="Sugestões Rejeitadas" value={counts.get("REJECTED") ?? 0} />
      </section>

      <section className="premium-panel rounded-[2rem] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Filtros e Escopo
            </p>
            <p className="mt-2 text-sm font-bold text-[var(--foreground-strong)]">
              {reviewSectors.map((sector) => SECTOR_LABELS[sector]).join(", ")}
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {filters.map((filter) => {
              const href = buildHref(filter.key);
              const isActive = selectedStatus === filter.key;

              return (
                <Link
                  key={filter.key}
                  className={`rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] transition-colors ${
                    isActive
                      ? "sector-bg sector-border sector-accent border text-white"
                      : "border-[var(--border)] bg-white text-[var(--foreground-soft)] hover:border-[var(--accent)] hover:text-[var(--foreground-strong)]"
                  }`}
                  href={href}
                >
                  {filter.label} ({filter.count})
                </Link>
              );
            })}
          </nav>
        </div>
      </section>

      {feedbacks.length === 0 ? (
        <section className="premium-panel rounded-[2rem] p-6">
          <p className="text-sm text-[var(--foreground-soft)]">
            Nenhuma indicacao de inconformidade encontrada para este filtro.
          </p>
        </section>
      ) : (
        <section className="space-y-4">
          {feedbacks.map((feedback) => {
            const document = documentByKey.get(
              `${feedback.sector}:${feedback.documentId}`,
            );
            const citation = findCitationSnapshot(
              feedback.message.citations,
              feedback,
            );
            const userMessage = userMessageByTrace.get(feedback.message.traceId);
            const isPending = feedback.status === "PENDING";
            const displayTitle =
              document?.documentTitle ??
              textValue(citation?.documentTitle) ??
              textValue(citation?.fileName) ??
              feedback.documentId;

            return (
              <article key={feedback.id} className="premium-panel rounded-[2rem] p-6">
                <header className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] ${statusClass(feedback.status)}`}
                      >
                        {feedback.status}
                      </span>
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--foreground-soft)]">
                        {SECTOR_LABELS[feedback.sector]}
                      </span>
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                        {formatDateTime(feedback.createdAt)}
                      </span>
                    </div>
                    <h2 className="text-lg font-black text-[var(--foreground-strong)]">
                      {displayTitle}
                    </h2>
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
                      Documento {feedback.documentId} | Trecho #
                      {feedback.chunkIndex}
                      {textValue(citation?.headingPathText)
                        ? ` | ${textValue(citation?.headingPathText)}`
                        : ""}
                    </p>
                  </div>

                  {isPending ? (
                    <div className="flex flex-wrap gap-2">
                      <form action={handleRejectCorrection}>
                        <input name="feedbackId" type="hidden" value={feedback.id} />
                        <button
                          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-rose-700"
                          type="submit"
                        >
                          Rejeitar
                        </button>
                      </form>
                      <form action={handleApproveCorrection}>
                        <input name="feedbackId" type="hidden" value={feedback.id} />
                        <button
                          className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-white"
                          type="submit"
                        >
                          Aprovar e aplicar
                        </button>
                      </form>
                    </div>
                  ) : (
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
                      Revisado por{" "}
                      {feedback.reviewer?.name ??
                        feedback.reviewer?.email ??
                        "usuario nao localizado"}
                    </p>
                  )}
                </header>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Conteudo original
                    </p>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground-strong)]">
                      {feedback.originalContent}
                    </pre>
                  </div>
                  <div className="rounded-3xl border border-[var(--border)] bg-white p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Sugestao enviada
                    </p>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground-strong)]">
                      {feedback.proposedContent}
                    </pre>
                  </div>
                </div>

                <details className="mt-5">
                  <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
                    Ver contexto da resposta
                  </summary>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-3xl border border-[var(--border)] bg-white p-4">
                      <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                        Pergunta do usuario
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground-strong)]">
                        {userMessage?.content ??
                          "(pergunta original nao localizada)"}
                      </p>
                    </div>
                    <div className="rounded-3xl border border-[var(--border)] bg-white p-4">
                      <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                        Resposta citada
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground-strong)]">
                        {feedback.message.content}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Metadados
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                      Enviado por {feedback.user.name} ({feedback.user.email}).
                      Conversa de {feedback.message.conversation.user.name} (
                      {feedback.message.conversation.user.email}). Trace{" "}
                      {feedback.message.traceId}.
                      {document
                        ? ` Documento em curadoria: ${document.status}; owner: ${document.owner ?? "-"}; topico: ${document.topic ?? "-"}.`
                        : " Documento de curadoria nao localizado para este trecho."}
                    </p>
                  </div>
                </details>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
