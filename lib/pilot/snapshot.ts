import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";

type JsonRecord = Record<string, unknown>;

export type PilotSnapshotConfig = {
  pilotUserEmails: string[];
  pilotSector?: string;
  sponsor?: string;
  champion?: string;
  snapshotDate: string;
  windowStart: Date;
  windowEnd: Date;
  standupNotes?: string;
};

export type PilotUserActivity = {
  userId: string;
  email: string;
  name: string;
  sector: string;
  messages: {
    user: number;
    assistant: number;
    total: number;
  };
  feedback: {
    good: number;
    bad: number;
    total: number;
  };
  corrections: {
    submitted: number;
    approved: number;
  };
};

export type TeamsResponseMetric = {
  notificationId: string;
  userEmail: string;
  sentAt: string;
  respondedAt: string | null;
  responseMinutes: number | null;
};

export type PilotSnapshotData = {
  config: PilotSnapshotConfig;
  configured: boolean;
  missingUsers: string[];
  users: PilotUserActivity[];
  totals: {
    messages: number;
    userMessages: number;
    assistantMessages: number;
    goodFeedback: number;
    badFeedback: number;
    openedGaps: number;
    closedGaps: number;
    correctionsApplied: number;
    teamsNotifications: number;
    teamsResponses: number;
    averageTeamsResponseMinutes: number | null;
  };
  teamsResponses: TeamsResponseMetric[];
};

export function parsePilotUserEmails(value?: string): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function parseSnapshotDate(value?: string, now = new Date()): string {
  if (!value) return now.toISOString().slice(0, 10);
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data invalida para snapshot: ${value}`);
  }
  return parsed.toISOString().slice(0, 10);
}

export function parseDateBoundary(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const trimmed = value.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00`)
    : new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data invalida: ${value}`);
  }

  return parsed;
}

export function startOfLocalDay(date = new Date()) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
}

function textFromPayload(payload: Prisma.JsonValue | null | undefined, key: string) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const value = (payload as JsonRecord)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value: number | null) {
  return value === null ? "n/a" : value.toFixed(1);
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function sortByTime<T extends { createdAt: Date }>(items: T[]) {
  return [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function buildPendingSnapshot(config: PilotSnapshotConfig): PilotSnapshotData {
  return {
    config,
    configured: false,
    missingUsers: config.pilotUserEmails,
    users: [],
    totals: {
      messages: 0,
      userMessages: 0,
      assistantMessages: 0,
      goodFeedback: 0,
      badFeedback: 0,
      openedGaps: 0,
      closedGaps: 0,
      correctionsApplied: 0,
      teamsNotifications: 0,
      teamsResponses: 0,
      averageTeamsResponseMinutes: null,
    },
    teamsResponses: [],
  };
}

export async function collectPilotSnapshotData(
  config: PilotSnapshotConfig,
): Promise<PilotSnapshotData> {
  if (config.pilotUserEmails.length === 0) {
    return buildPendingSnapshot(config);
  }

  const users = await prisma.user.findMany({
    where: {
      email: { in: config.pilotUserEmails },
      ...(config.pilotSector ? { sector: config.pilotSector as never } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      sector: true,
    },
  });

  const userIds = users.map((user) => user.id);
  const userIdsSet = new Set(userIds);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const usersByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  const missingUsers = config.pilotUserEmails.filter(
    (email) => !usersByEmail.has(email),
  );

  if (users.length === 0) {
    return {
      ...buildPendingSnapshot(config),
      configured: true,
      missingUsers,
    };
  }

  const whereWindow = {
    gte: config.windowStart,
    lte: config.windowEnd,
  };
  const conversations = await prisma.conversation.findMany({
    where: {
      userId: { in: userIds },
      createdAt: { lte: config.windowEnd },
    },
    select: { id: true, userId: true },
  });
  const conversationIds = conversations.map((conversation) => conversation.id);
  const conversationUserId = new Map(
    conversations.map((conversation) => [conversation.id, conversation.userId]),
  );

  const [
    messages,
    feedbackEvents,
    submittedCorrections,
    approvedCorrections,
    openedGaps,
    closedGaps,
    correctionsApplied,
    notificationEvents,
    actionAuditEvents,
  ] = await Promise.all([
    conversationIds.length > 0
      ? prisma.message.findMany({
          where: {
            conversationId: { in: conversationIds },
            createdAt: whereWindow,
          },
          select: { conversationId: true, role: true, createdAt: true },
        })
      : Promise.resolve([]),
    userIds.length > 0
      ? prisma.auditEvent.findMany({
          where: {
            actorId: { in: userIds },
            eventType: "user.feedback",
            createdAt: whereWindow,
          },
          select: { actorId: true, payload: true, createdAt: true },
        })
      : Promise.resolve([]),
    userIds.length > 0
      ? prisma.chunkFeedback.findMany({
          where: {
            userId: { in: userIds },
            createdAt: whereWindow,
          },
          select: { userId: true, status: true, createdAt: true },
        })
      : Promise.resolve([]),
    userIds.length > 0
      ? prisma.chunkFeedback.findMany({
          where: {
            userId: { in: userIds },
            status: "APPROVED",
            updatedAt: whereWindow,
          },
          select: { userId: true, status: true, updatedAt: true },
        })
      : Promise.resolve([]),
    prisma.processGapQuestion.count({
      where: {
        createdAt: whereWindow,
        ...(config.pilotSector
          ? { processMap: { sector: config.pilotSector as never } }
          : {}),
      },
    }),
    prisma.processGapQuestion.count({
      where: {
        answeredAt: whereWindow,
        status: { in: ["answered", "closed"] },
        ...(config.pilotSector
          ? { processMap: { sector: config.pilotSector as never } }
          : {}),
      },
    }),
    prisma.chunkFeedback.count({
      where: {
        status: "APPROVED",
        updatedAt: whereWindow,
        ...(config.pilotSector ? { sector: config.pilotSector as never } : {}),
      },
    }),
    prisma.auditEvent.findMany({
      where: {
        eventType: "notification.sent",
        targetId: { in: config.pilotUserEmails },
        createdAt: whereWindow,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, targetId: true, createdAt: true, payload: true },
    }),
    userIds.length > 0
      ? prisma.auditEvent.findMany({
          where: {
            actorId: { in: userIds },
            eventType: {
              in: [
                "process_gap.answered",
                "user.feedback",
                "document.approved",
                "document.promoted",
              ],
            },
            createdAt: whereWindow,
          },
          select: { actorId: true, eventType: true, createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  const activityByUser = new Map(
    users.map((user) => [
      user.id,
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        sector: String(user.sector),
        messages: { user: 0, assistant: 0, total: 0 },
        feedback: { good: 0, bad: 0, total: 0 },
        corrections: { submitted: 0, approved: 0 },
      } satisfies PilotUserActivity,
    ]),
  );

  for (const message of messages) {
    const userId = conversationUserId.get(message.conversationId);
    if (!userId) continue;
    const activity = activityByUser.get(userId);
    if (!activity) continue;
    activity.messages.total += 1;
    if (message.role === "user") activity.messages.user += 1;
    if (message.role === "assistant") activity.messages.assistant += 1;
  }

  for (const event of feedbackEvents) {
    const activity = activityByUser.get(event.actorId);
    if (!activity) continue;
    const value = textFromPayload(event.payload, "value");
    if (value === "good") activity.feedback.good += 1;
    if (value === "bad") activity.feedback.bad += 1;
    activity.feedback.total += 1;
  }

  for (const correction of submittedCorrections) {
    activityByUser.get(correction.userId)!.corrections.submitted += 1;
  }

  for (const correction of approvedCorrections) {
    activityByUser.get(correction.userId)!.corrections.approved += 1;
  }

  const actionDatesByEmail = new Map<string, Date[]>();
  for (const event of actionAuditEvents) {
    if (!userIdsSet.has(event.actorId)) continue;
    const user = usersById.get(event.actorId);
    if (!user) continue;
    const key = user.email.toLowerCase();
    const dates = actionDatesByEmail.get(key) ?? [];
    dates.push(event.createdAt);
    actionDatesByEmail.set(key, dates);
  }

  for (const message of messages.filter((message) => message.role === "user")) {
    const userId = conversationUserId.get(message.conversationId);
    const user = userId ? usersById.get(userId) : undefined;
    if (!user) continue;
    const key = user.email.toLowerCase();
    const dates = actionDatesByEmail.get(key) ?? [];
    dates.push(message.createdAt);
    actionDatesByEmail.set(key, dates);
  }

  const teamsResponses = notificationEvents.map((event) => {
    const key = event.targetId.toLowerCase();
    const actions = sortByTime(
      (actionDatesByEmail.get(key) ?? []).map((createdAt) => ({ createdAt })),
    );
    const nextAction = actions.find(
      (action) => action.createdAt.getTime() > event.createdAt.getTime(),
    );
    return {
      notificationId: event.id,
      userEmail: event.targetId,
      sentAt: event.createdAt.toISOString(),
      respondedAt: nextAction?.createdAt.toISOString() ?? null,
      responseMinutes: nextAction
        ? minutesBetween(event.createdAt, nextAction.createdAt)
        : null,
    } satisfies TeamsResponseMetric;
  });

  const responseMinutes = teamsResponses
    .map((item) => item.responseMinutes)
    .filter((value): value is number => value !== null);
  const activities = Array.from(activityByUser.values()).sort((a, b) =>
    a.email.localeCompare(b.email),
  );

  return {
    config,
    configured: true,
    missingUsers,
    users: activities,
    totals: {
      messages: activities.reduce((sum, item) => sum + item.messages.total, 0),
      userMessages: activities.reduce((sum, item) => sum + item.messages.user, 0),
      assistantMessages: activities.reduce(
        (sum, item) => sum + item.messages.assistant,
        0,
      ),
      goodFeedback: activities.reduce((sum, item) => sum + item.feedback.good, 0),
      badFeedback: activities.reduce((sum, item) => sum + item.feedback.bad, 0),
      openedGaps,
      closedGaps,
      correctionsApplied,
      teamsNotifications: notificationEvents.length,
      teamsResponses: responseMinutes.length,
      averageTeamsResponseMinutes: average(responseMinutes),
    },
    teamsResponses,
  };
}

export function renderPilotSnapshotMarkdown(data: PilotSnapshotData) {
  const { config, totals } = data;
  const lines = [
    `# Snapshot do piloto - ${config.snapshotDate}`,
    "",
    "## Janela",
    "",
    `- Inicio: ${config.windowStart.toISOString()}`,
    `- Fim: ${config.windowEnd.toISOString()}`,
    `- Setor piloto: ${config.pilotSector ?? "pendente"}`,
    `- Patrocinador: ${config.sponsor ?? "pendente"}`,
    `- Champion: ${config.champion ?? "pendente"}`,
    `- Usuarios configurados: ${
      config.pilotUserEmails.length > 0
        ? config.pilotUserEmails.join(", ")
        : "pendente"
    }`,
  ];

  if (!data.configured || data.missingUsers.length > 0) {
    lines.push("", "## Pendencias de configuracao", "");
    if (!data.configured) {
      lines.push(
        "- Definir `PILOT_USER_EMAILS` com os 5 usuarios reais do piloto antes de usar este snapshot como evidencia.",
      );
    }
    for (const email of data.missingUsers) {
      lines.push(`- Usuario nao encontrado no banco: ${email}`);
    }
  }

  lines.push(
    "",
    "## Indicadores",
    "",
    `- Mensagens totais dos usuarios piloto: ${totals.messages}`,
    `- Mensagens enviadas pelos usuarios piloto: ${totals.userMessages}`,
    `- Respostas do sistema nas conversas piloto: ${totals.assistantMessages}`,
    `- Feedback positivo/negativo: ${totals.goodFeedback}/${totals.badFeedback}`,
    `- Lacunas abertas no periodo: ${totals.openedGaps}`,
    `- Lacunas fechadas/respondidas no periodo: ${totals.closedGaps}`,
    `- Correcoes aplicadas via curadoria: ${totals.correctionsApplied}`,
    `- Notificacoes Teams para pilotos: ${totals.teamsNotifications}`,
    `- Notificacoes com acao posterior detectada: ${totals.teamsResponses}`,
    `- Tempo medio ate primeira acao apos Teams: ${formatNumber(
      totals.averageTeamsResponseMinutes,
    )} min`,
    "",
    "## Mensagens por usuario",
    "",
  );

  if (data.users.length === 0) {
    lines.push("- Nenhum usuario piloto com atividade nesta janela.");
  } else {
    for (const user of data.users) {
      lines.push(
        `- ${user.name} <${user.email}> (${user.sector}): ${user.messages.total} mensagens (${user.messages.user} usuario, ${user.messages.assistant} sistema), feedback ${user.feedback.good}/${user.feedback.bad}, correcoes ${user.corrections.submitted} submetidas/${user.corrections.approved} aprovadas.`,
      );
    }
  }

  lines.push("", "## Resposta a notificacoes Teams", "");

  if (data.teamsResponses.length === 0) {
    lines.push("- Nenhuma notificacao `notification.sent` para usuarios piloto nesta janela.");
  } else {
    for (const item of data.teamsResponses.slice(0, 20)) {
      lines.push(
        `- ${item.userEmail}: enviada em ${item.sentAt}; primeira acao: ${
          item.respondedAt ?? "nao detectada"
        }; tempo: ${
          item.responseMinutes === null ? "n/a" : `${item.responseMinutes} min`
        }.`,
      );
    }
  }

  lines.push(
    "",
    "## Anexo qualitativo do stand-up",
    "",
    config.standupNotes?.trim()
      ? config.standupNotes.trim()
      : "- Pendente: registrar travas, decisoes e narrativa do dia com o champion.",
    "",
    "## Observacoes",
    "",
    "- A metrica de resposta Teams e inferida por auditoria: primeira mensagem ou acao auditada do usuario apos `notification.sent`.",
    "- Eventos antigos sem `notification.sent` ou acoes fora da janela nao entram no calculo.",
  );

  return `${lines.join("\n")}\n`;
}

export async function writePilotSnapshot(data: PilotSnapshotData) {
  const outputDir = path.join(process.cwd(), "docs", "pmo", "pilot-snapshots");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${data.config.snapshotDate}.md`);
  await writeFile(outputPath, renderPilotSnapshotMarkdown(data), "utf8");
  return outputPath;
}
