import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import {
  getAgentPersonality,
  upsertAgentPersonality,
} from "@/lib/agents/personality";
import { safePublishAuditEvent } from "@/lib/bus/publisher";
import { z } from "zod";

const personalitySchema = z.object({
  tone: z.number().int().min(1).max(5).optional(),
  verbosity: z.number().int().min(1).max(5).optional(),
  formality: z.number().int().min(1).max(5).optional(),
  proactivity: z.number().int().min(1).max(5).optional(),
  escalationThreshold: z.number().min(0).max(1).optional(),
  domainEmphasis: z
    .array(z.object({ topic: z.string().min(1), weight: z.number().min(0).max(1) }))
    .max(20)
    .optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ sector: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { sector } = await context.params;
  if (!isSector(sector)) return jsonError("Setor invalido.", 400);

  const personality = await getAgentPersonality(sector);

  return Response.json(
    personality ?? {
      sector,
      tone: 3,
      verbosity: 3,
      formality: 3,
      proactivity: 3,
      escalationThreshold: 0.4,
      domainEmphasis: [],
      updatedAt: null,
      updatedBy: null,
    },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sector: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { sector } = await context.params;
  if (!isSector(sector)) return jsonError("Setor invalido.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corpo invalido.", 400);
  }

  const parsed = personalitySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      `Validacao falhou: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }

  const before = await getAgentPersonality(sector);
  const after = await upsertAgentPersonality(
    sector,
    parsed.data,
    session.user.id ?? session.user.email ?? null,
  );

  await safePublishAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id ?? session.user.email ?? "unknown",
    targetType: "agent",
    targetId: sector,
    eventType: "agent_personality.updated",
    payload: {
      changes: parsed.data,
      before,
      after,
    },
  });

  return Response.json(after);
}
