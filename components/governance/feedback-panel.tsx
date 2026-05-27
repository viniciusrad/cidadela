import type { Prisma } from "@prisma/client";
import Link from "next/link";

import { prisma } from "@/lib/db/client";
import { SECTORS, type Sector } from "@/lib/domain";
import { getSectorLabel, PERSONA_LABELS } from "@/lib/labels";

type FeedbackValue = "good" | "bad";
type FilterKey = FeedbackValue | "all" | "unanswered";
type PeriodKey = "all" | "day" | "week" | "month";

type FeedbackPayload = {
  value?: FeedbackValue;
  conversationId?: string;
  sector?: Sector;
  comment?: string;
};

type UnansweredPayload = {
  sector?: Sector;
  question?: string;
};

const PAGE_LIMITS = [25, 50, 100] as const;

const BASE_HREF = "/admin/governance";

function parseFilter(value: string | undefined): FilterKey {
  if (value === "good" || value === "bad" || value === "unanswered") return value;
  return "all";
}

function parseSector(value: string | undefined): Sector | "all" {
  return SECTORS.find((sector) => sector === value) ?? "all";
}

function parsePeriod(value: string | undefined): PeriodKey {
  if (value === "day" || value === "week" || value === "month") return value;
  return "all";
}

function parseLimit(value: string | undefined) {
  const limit = Number(value);
  return PAGE_LIMITS.find((option) => option === limit) ?? PAGE_LIMITS[0];
}

function parsePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function cleanSearch(value: string | undefined) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function periodStart(period: PeriodKey) {
  if (period === "all") return null;

  const now = new Date();
  const days = period === "day" ? 1 : period === "week" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function dateWhere(period: PeriodKey): Prisma.AuditEventWhereInput {
  const start = periodStart(period);
  return start ? { createdAt: { gte: start } } : {};
}

function searchWhere(search: string): Prisma.AuditEventWhereInput {
  if (!search) return {};

  return {
    OR: [
      { traceId: { contains: search, mode: "insensitive" } },
      { actorId: { contains: search, mode: "insensitive" } },
      { targetId: { contains: search, mode: "insensitive" } },
    ],
  };
}

function sectorWhere(sector: Sector | "all"): Prisma.AuditEventWhereInput {
  if (sector === "all") return {};

  return {
    AND: [
      {
        payload: {
          path: ["sector"],
          equals: sector,
        },
      },
    ],
  };
}

function scopedEventWhere({
  eventType,
  sector,
  period,
  search,
}: {
  eventType: "user.feedback" | "agent.unanswered";
  sector: Sector | "all";
  period: PeriodKey;
  search: string;
}): Prisma.AuditEventWhereInput {
  return {
    eventType,
    ...dateWhere(period),
    ...sectorWhere(sector),
    ...searchWhere(search),
  };
}

function feedbackWhere(
  value: FeedbackValue | "all",
  options: {
    sector: Sector | "all";
    period: PeriodKey;
    search: string;
  },
): Prisma.AuditEventWhereInput {
  return {
    ...scopedEventWhere({
      eventType: "user.feedback",
      ...options,
    }),
    ...(value === "all"
      ? {}
      : {
          payload: {
            path: ["value"],
            equals: value,
          },
        }),
  };
}

function clampText(value: string | null | undefined, fallback: string, maxLength = 180) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function pageRange(page: number, limit: number, total: number) {
  if (total === 0) return "0";

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  return `${start}-${end}`;
}

function getPageHref(
  filters: {
    filter: FilterKey;
    sector: Sector | "all";
    period: PeriodKey;
    limit: number;
    search: string;
    trace: string | null;
  },
  overrides: Partial<{ filter: FilterKey; page: number }>,
) {
  const query = new URLSearchParams();
  query.set("tab", "feedback");
  const filter = overrides.filter ?? filters.filter;

  if (filter !== "all") query.set("value", filter);
  if (filters.sector !== "all") query.set("sector", filters.sector);
  if (filters.period !== "all") query.set("period", filters.period);
  if (filters.limit !== PAGE_LIMITS[0]) query.set("limit", String(filters.limit));
  if (filters.search) query.set("q", filters.search);
  if (filters.trace) query.set("trace", filters.trace);
  if (overrides.page && overrides.page > 1) query.set("page", String(overrides.page));

  return `${BASE_HREF}?${query.toString()}`;
}

function badgeClass(value: FeedbackValue | "unanswered") {
  if (value === "good") return "bg-emerald-100 text-emerald-700";
  if (value === "bad") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-800";
}

function TraceMessages({
  messages,
}: {
  messages: Array<{
    id: string;
    role: string;
    agentId: string | null;
    content: string;
    createdAt: Date;
  }>;
}) {
  return (
    <ol className="space-y-2">
      {messages.map((message) => (
        <li
          className="rounded-2xl border border-[var(--border)] bg-white p-3"
          key={message.id}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            <span>
              {message.role}
              {message.agentId ? ` | ${message.agentId}` : ""}
            </span>
            <span>{formatDateTime(message.createdAt)}</span>
          </div>
          <p className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground-strong)]">
            {message.content}
          </p>
        </li>
      ))}
    </ol>
  );
}

export async function FeedbackPanel({
  searchParams,
}: {
  searchParams: {
    value?: string;
    trace?: string;
    q?: string;
    sector?: string;
    period?: string;
    limit?: string;
    page?: string;
  };
}) {
  const filter = parseFilter(searchParams.value);
  const sector = parseSector(searchParams.sector);
  const period = parsePeriod(searchParams.period);
  const limit = parseLimit(searchParams.limit);
  const focusedTrace = cleanSearch(searchParams.trace) || null;
  const search = cleanSearch(searchParams.q) || focusedTrace || "";
  const requestedPage = parsePage(searchParams.page);
  const feedbackScope = { sector, period, search };
  const unansweredWhere = scopedEventWhere({
    eventType: "agent.unanswered",
    ...feedbackScope,
  });

  const [feedbackCount, goodCount, badCount, unansweredCount] = await Promise.all([
    prisma.auditEvent.count({ where: feedbackWhere("all", feedbackScope) }),
    prisma.auditEvent.count({ where: feedbackWhere("good", feedbackScope) }),
    prisma.auditEvent.count({ where: feedbackWhere("bad", feedbackScope) }),
    prisma.auditEvent.count({ where: unansweredWhere }),
  ]);

  const selectedTotal =
    filter === "unanswered"
      ? unansweredCount
      : filter === "good"
        ? goodCount
        : filter === "bad"
          ? badCount
          : feedbackCount;
  const totalPages = Math.max(1, Math.ceil(selectedTotal / limit));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;
  const selectedWhere =
    filter === "unanswered"
      ? unansweredWhere
      : feedbackWhere(filter === "all" ? "all" : filter, feedbackScope);
  const events = await prisma.auditEvent.findMany({
    where: selectedWhere,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  const hrefFilters = {
    filter,
    sector,
    period,
    limit,
    search,
    trace: focusedTrace,
  };
  const filterLinks: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: "Todos", count: feedbackCount },
    { key: "good", label: "Boas", count: goodCount },
    { key: "bad", label: "Ruins", count: badCount },
    { key: "unanswered", label: "Sem resposta", count: unansweredCount },
  ];

  const clearHref =
    filter === "all"
      ? `${BASE_HREF}?tab=feedback`
      : `${BASE_HREF}?tab=feedback&value=${filter}`;

  const pagination = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--foreground-soft)]">
      <p className="font-bold uppercase tracking-[0.18em]">
        Exibindo {pageRange(page, limit, selectedTotal)} de {selectedTotal}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-xl bg-[var(--surface-muted)] px-3 py-2 font-bold">
          Pagina {page} de {totalPages}
        </span>
        <Link
          aria-disabled={page <= 1}
          className={`rounded-xl border px-3 py-2 font-bold ${
            page <= 1
              ? "pointer-events-none border-[var(--border)] text-[var(--muted)]"
              : "border-[var(--border-strong)] bg-white text-[var(--foreground-strong)]"
          }`}
          href={getPageHref(hrefFilters, { page: page - 1 })}
        >
          Anterior
        </Link>
        <Link
          aria-disabled={page >= totalPages}
          className={`rounded-xl border px-3 py-2 font-bold ${
            page >= totalPages
              ? "pointer-events-none border-[var(--border)] text-[var(--muted)]"
              : "border-[var(--border-strong)] bg-white text-[var(--foreground-strong)]"
          }`}
          href={getPageHref(hrefFilters, { page: page + 1 })}
        >
          Proxima
        </Link>
      </div>
    </div>
  );

  let feedbackRows = null;
  let unansweredRows = null;

  if (filter === "unanswered") {
    const conversationIds = [...new Set(events.map((event) => event.targetId))];
    const traceIds = [...new Set(events.map((event) => event.traceId))];
    const [conversations, traceMessages] = await Promise.all([
      prisma.conversation.findMany({
        where: { id: { in: conversationIds } },
        include: { user: true },
      }),
      prisma.message.findMany({
        where: { traceId: { in: traceIds } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const conversationById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    const messagesByTrace = new Map<string, typeof traceMessages>();

    for (const message of traceMessages) {
      const trace = messagesByTrace.get(message.traceId) ?? [];
      trace.push(message);
      messagesByTrace.set(message.traceId, trace);
    }

    unansweredRows = events.map((event) => {
      const payload = (event.payload ?? {}) as UnansweredPayload;
      const eventSector = payload.sector ?? event.actorId;
      const conversation = conversationById.get(event.targetId);
      const traceMessagesForEvent = messagesByTrace.get(event.traceId) ?? [];
      const userMessage = traceMessagesForEvent.find((message) => message.role === "user");
      const assistantMessage = traceMessagesForEvent.find((message) => message.role === "assistant");

      return (
        <tr className="border-t border-[var(--border)] align-top" id={event.traceId} key={event.id}>
          <td colSpan={6} className="p-0">
            <details className="group" open={focusedTrace === event.traceId}>
              <summary className="grid min-w-[900px] cursor-pointer list-none grid-cols-[140px_minmax(320px,1fr)_190px_150px_150px_112px] items-start gap-4 px-4 py-3 transition-colors hover:bg-amber-50/50">
                <span className={`w-fit rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${badgeClass("unanswered")}`}>
                  Sem resposta
                </span>
                <span>
                  <span className="block font-bold text-[var(--foreground-strong)]">
                    {clampText(userMessage?.content ?? payload.question, "Pergunta nao registrada")}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--foreground-soft)]">
                    {conversation?.title ?? "Conversa nao localizada"}
                  </span>
                </span>
                <span className="text-sm text-[var(--foreground-soft)]">
                  {conversation?.user?.name ?? "Usuario nao localizado"}
                  {conversation?.user?.email ? (
                    <span className="mt-1 block truncate text-xs">{conversation.user.email}</span>
                  ) : null}
                </span>
                <span className="text-sm font-bold text-[var(--foreground-strong)]">
                  {getSectorLabel(eventSector)}
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  {formatDateTime(event.createdAt)}
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                  Abrir
                  <span className="mt-1 block text-[var(--muted)]">
                    {traceMessagesForEvent.length} msgs
                  </span>
                </span>
              </summary>
              <div className="border-t border-[var(--border)] bg-amber-50/30 px-4 py-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-800">
                      Pergunta sem resposta
                    </p>
                    <p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-amber-950">
                      {userMessage?.content ?? payload.question ?? "(pergunta nao registrada)"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                      Resposta gerada
                      {assistantMessage?.agentId
                        ? ` | ${PERSONA_LABELS[assistantMessage.agentId as Sector] ?? assistantMessage.agentId}`
                        : ""}
                    </p>
                    <p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground-strong)]">
                      {assistantMessage?.content ?? "(resposta nao localizada)"}
                    </p>
                  </div>
                </div>
                <details className="mt-4 rounded-2xl border border-[var(--border)] bg-white p-4">
                  <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
                    Ver trace completo | {event.traceId.slice(0, 8)}
                  </summary>
                  <div className="mt-3">
                    <TraceMessages messages={traceMessagesForEvent} />
                  </div>
                </details>
              </div>
            </details>
          </td>
        </tr>
      );
    });
  } else {
    const messageIds = events.map((event) => event.targetId);
    const traceIds = [...new Set(events.map((event) => event.traceId))];
    const reviewerIds = [...new Set(events.map((event) => event.actorId))];
    const [assistantMessages, traceMessages, agentCalls, reviewers] = await Promise.all([
      prisma.message.findMany({
        where: { id: { in: messageIds } },
        include: { conversation: { include: { user: true } } },
      }),
      prisma.message.findMany({
        where: { traceId: { in: traceIds } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.agentCall.findMany({
        where: { traceId: { in: traceIds } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.user.findMany({
        where: { id: { in: reviewerIds } },
        select: { id: true, name: true, email: true },
      }),
    ]);
    const assistantById = new Map(assistantMessages.map((message) => [message.id, message]));
    const reviewerById = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer]));
    const messagesByTrace = new Map<string, typeof traceMessages>();
    const callsByTrace = new Map<string, typeof agentCalls>();

    for (const message of traceMessages) {
      const trace = messagesByTrace.get(message.traceId) ?? [];
      trace.push(message);
      messagesByTrace.set(message.traceId, trace);
    }

    for (const call of agentCalls) {
      const trace = callsByTrace.get(call.traceId) ?? [];
      trace.push(call);
      callsByTrace.set(call.traceId, trace);
    }

    feedbackRows = events.map((event) => {
      const payload = (event.payload ?? {}) as FeedbackPayload;
      const value: FeedbackValue = payload.value === "bad" ? "bad" : "good";
      const assistant = assistantById.get(event.targetId);
      const reviewer = reviewerById.get(event.actorId);
      const traceMessagesForEvent = messagesByTrace.get(event.traceId) ?? [];
      const traceCalls = callsByTrace.get(event.traceId) ?? [];
      const userMessage = traceMessagesForEvent.find((message) => message.role === "user");
      const conversation = assistant?.conversation;

      return (
        <tr className="border-t border-[var(--border)] align-top" id={event.traceId} key={event.id}>
          <td colSpan={6} className="p-0">
            <details className="group" open={focusedTrace === event.traceId}>
              <summary className="grid min-w-[900px] cursor-pointer list-none grid-cols-[140px_minmax(320px,1fr)_190px_150px_150px_112px] items-start gap-4 px-4 py-3 transition-colors hover:bg-[var(--surface-soft)]">
                <span className={`w-fit rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${badgeClass(value)}`}>
                  {value === "good" ? "Boa" : "Ruim"}
                </span>
                <span>
                  <span className="block font-bold text-[var(--foreground-strong)]">
                    {clampText(userMessage?.content, "Pergunta original nao localizada")}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--foreground-soft)]">
                    {clampText(
                      assistant?.content,
                      "Resposta nao localizada",
                      120,
                    )}
                  </span>
                </span>
                <span className="text-sm text-[var(--foreground-soft)]">
                  {reviewer?.name ?? "Avaliador nao localizado"}
                  {reviewer?.email ? (
                    <span className="mt-1 block truncate text-xs">{reviewer.email}</span>
                  ) : null}
                </span>
                <span className="text-sm font-bold text-[var(--foreground-strong)]">
                  {getSectorLabel(payload.sector ?? conversation?.sector ?? "sem-setor")}
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  {formatDateTime(event.createdAt)}
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                  Abrir
                  <span className="mt-1 block text-[var(--muted)]">
                    {traceCalls.length} hops
                  </span>
                </span>
              </summary>
              <div className="border-t border-[var(--border)] bg-[var(--surface-soft)] px-4 py-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                      Pergunta do usuario
                      {conversation?.user?.name ? ` | ${conversation.user.name}` : ""}
                    </p>
                    <p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground-strong)]">
                      {userMessage?.content ?? "(pergunta original nao localizada)"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                      Resposta do agente
                      {assistant?.agentId
                        ? ` | ${PERSONA_LABELS[assistant.agentId as Sector] ?? assistant.agentId}`
                        : ""}
                    </p>
                    <p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground-strong)]">
                      {assistant?.content ?? "(resposta nao localizada)"}
                    </p>
                  </div>
                </div>

                {value === "bad" && payload.comment ? (
                  <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-700">
                      Comentario do usuario
                    </p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-rose-950">
                      {payload.comment}
                    </p>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
                  <details className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
                      Ver mensagens do trace | {traceMessagesForEvent.length}
                    </summary>
                    <div className="mt-3">
                      <TraceMessages messages={traceMessagesForEvent} />
                    </div>
                  </details>
                  <details className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
                      Encaminhamentos | {traceCalls.length}
                    </summary>
                    {traceCalls.length === 0 ? (
                      <p className="mt-3 text-sm text-[var(--foreground-soft)]">
                        Nenhum encaminhamento entre agentes neste trace.
                      </p>
                    ) : (
                      <ol className="mt-3 space-y-2">
                        {traceCalls.map((call) => (
                          <li
                            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"
                            key={call.id}
                          >
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                              {call.fromAgent} {"->"} {call.toAgent} | {call.status}
                            </p>
                            <p className="mt-2 text-sm text-[var(--foreground-strong)]">
                              {call.intent}
                              {typeof call.latencyMs === "number" ? ` | ${call.latencyMs}ms` : ""}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </details>
                </div>
              </div>
            </details>
          </td>
        </tr>
      );
    });
  }

  return (
    <div className="space-y-5">
      <section className="premium-panel rounded-[2rem] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
              Recorte da fila
            </p>
            <h2 className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
              Revisao compacta de qualidade
            </h2>
          </div>
          <nav className="flex flex-wrap gap-2">
            {filterLinks.map((link) => {
              const active = filter === link.key;
              return (
                <Link
                  className={`rounded-2xl border px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] transition-colors ${
                    active
                      ? "sector-bg sector-border sector-accent"
                      : "border-[var(--border)] bg-white text-[var(--foreground-soft)] hover:border-[var(--border-strong)]"
                  }`}
                  href={getPageHref(hrefFilters, { filter: link.key, page: 1 })}
                  key={link.key}
                >
                  {link.label} ({link.count})
                </Link>
              );
            })}
          </nav>
        </div>

        <form
          action={BASE_HREF}
          className="mt-5 grid gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_180px_140px_auto]"
        >
          <input name="tab" type="hidden" value="feedback" />
          {filter !== "all" ? <input name="value" type="hidden" value={filter} /> : null}
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            Trace ou ID
            <input
              className="h-11 rounded-2xl border border-[var(--border)] bg-white px-4 text-sm font-medium tracking-normal text-[var(--foreground-strong)] outline-none focus:border-[var(--border-strong)]"
              defaultValue={search}
              name="q"
              placeholder="Buscar trace, ator ou alvo"
            />
          </label>
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            Setor
            <select
              className="h-11 rounded-2xl border border-[var(--border)] bg-white px-3 text-sm font-medium tracking-normal text-[var(--foreground-strong)]"
              defaultValue={sector}
              name="sector"
            >
              <option value="all">Todos</option>
              {SECTORS.map((option) => (
                <option key={option} value={option}>
                  {getSectorLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            Periodo
            <select
              className="h-11 rounded-2xl border border-[var(--border)] bg-white px-3 text-sm font-medium tracking-normal text-[var(--foreground-strong)]"
              defaultValue={period}
              name="period"
            >
              <option value="all">Tudo</option>
              <option value="day">24 horas</option>
              <option value="week">7 dias</option>
              <option value="month">30 dias</option>
            </select>
          </label>
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            Limite
            <select
              className="h-11 rounded-2xl border border-[var(--border)] bg-white px-3 text-sm font-medium tracking-normal text-[var(--foreground-strong)]"
              defaultValue={limit}
              name="limit"
            >
              {PAGE_LIMITS.map((option) => (
                <option key={option} value={option}>
                  {option} itens
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              className="h-11 rounded-2xl bg-[var(--accent)] px-4 text-xs font-bold uppercase tracking-[0.18em] text-white"
              type="submit"
            >
              Filtrar
            </button>
            <Link
              className="flex h-11 items-center rounded-2xl border border-[var(--border)] bg-white px-4 text-xs font-bold uppercase tracking-[0.18em] text-[var(--foreground-soft)]"
              href={clearHref}
            >
              Limpar
            </Link>
          </div>
        </form>
      </section>

      <section className="premium-panel overflow-hidden rounded-[2rem]">
        {pagination}
        {events.length === 0 ? (
          <div className="px-5 py-8 text-sm text-[var(--foreground-soft)]">
            Nenhum item encontrado para este recorte.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="bg-[var(--surface-muted)] text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                <tr>
                  <th className="w-[140px] px-4 py-3">Sinal</th>
                  <th className="px-4 py-3">Pergunta e contexto</th>
                  <th className="w-[190px] px-4 py-3">
                    {filter === "unanswered" ? "Usuario" : "Avaliador"}
                  </th>
                  <th className="w-[150px] px-4 py-3">Setor</th>
                  <th className="w-[150px] px-4 py-3">Data</th>
                  <th className="w-[112px] px-4 py-3">Detalhes</th>
                </tr>
              </thead>
              <tbody>{filter === "unanswered" ? unansweredRows : feedbackRows}</tbody>
            </table>
          </div>
        )}
        {pagination}
      </section>
    </div>
  );
}
