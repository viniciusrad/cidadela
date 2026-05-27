import type { Prisma } from "@prisma/client";

import type { HumanCaptchaAutomationIntent } from "@/lib/automation/cervello-ticket";
import type { Sector } from "@/lib/domain";

export type AutomationApprovalRequest = {
  approvalId: string;
  intent: HumanCaptchaAutomationIntent;
  processKey: string;
  label: string;
  ownerSector: "desenvolvimento";
  requesterSector: Sector;
  originalQuestion: string;
  originalMessageId: string;
  idempotencySuffix: string;
};

export type ApprovalDecision =
  | { status: "confirmed"; reason: string }
  | { status: "cancelled" }
  | { status: "needs_reason" }
  | { status: "unknown" };

function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseAutomationApprovalPayload(
  payload: Prisma.JsonValue | null,
): AutomationApprovalRequest | null {
  if (!isObject(payload)) {
    return null;
  }

  const approvalId = readString(payload.approvalId);
  const intent = readString(payload.intent) as HumanCaptchaAutomationIntent | null;
  const processKey = readString(payload.processKey);
  const label = readString(payload.label);
  const requesterSector = readString(payload.requesterSector) as Sector | null;
  const originalQuestion = readString(payload.originalQuestion);
  const originalMessageId = readString(payload.originalMessageId);
  const idempotencySuffix = readString(payload.idempotencySuffix);

  if (
    !approvalId ||
    !intent ||
    !processKey ||
    !label ||
    !requesterSector ||
    !originalQuestion ||
    !originalMessageId ||
    !idempotencySuffix
  ) {
    return null;
  }

  return {
    approvalId,
    intent,
    processKey,
    label,
    ownerSector: "desenvolvimento",
    requesterSector,
    originalQuestion,
    originalMessageId,
    idempotencySuffix,
  };
}

function extractReason(question: string) {
  const explicit = question.match(
    /(?:motivo|justificativa|razao|razão)\s*:\s*(.+)$/i,
  )?.[1];
  if (explicit?.trim()) {
    return explicit.trim();
  }

  const because = question.match(/\b(?:porque|pois|para)\b\s+(.+)$/i)?.[1];
  if (because?.trim()) {
    return because.trim();
  }

  return question
    .replace(/^\s*(sim|confirmo|pode|autorizo|aprovado|ok)[,.\s-]*/i, "")
    .trim();
}

export function parseApprovalDecision(question: string): ApprovalDecision {
  const normalized = normalizeForMatch(question);

  if (/^(nao|cancelar|cancela|cancele|desistir|desisto)\b/.test(normalized)) {
    return { status: "cancelled" };
  }

  const hasConfirmation =
    /^(sim|confirmo|pode|autorizo|aprovado|ok)\b/.test(normalized) ||
    /\b(pode acionar|pode abrir|pode criar|autorizo)\b/.test(normalized);

  if (!hasConfirmation) {
    return { status: "unknown" };
  }

  const reason = extractReason(question);
  if (reason.length < 6) {
    return { status: "needs_reason" };
  }

  return {
    status: "confirmed",
    reason,
  };
}
