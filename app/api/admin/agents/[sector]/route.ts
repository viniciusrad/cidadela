import { randomUUID } from "node:crypto";
import { z } from "zod";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { getEffectiveAgent } from "@/lib/agents/effective";
import { upsertAgentConfig } from "@/lib/agents/config-repo";
import { safePublishAuditEvent } from "@/lib/bus/publisher";

export const runtime = "nodejs";

const capabilitySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  isExposed: z.boolean(),
});

const patchSchema = z.object({
  displayName: z.string().min(1).max(80).nullable().optional(),
  summary: z.string().min(1).max(400).nullable().optional(),
  instructions: z.string().min(1).max(8000).nullable().optional(),
  capabilities: z.array(capabilitySchema).max(40).nullable().optional(),
  chatModel: z.string().min(1).max(120).nullable().optional(),
  topK: z.number().int().min(1).max(20).nullable().optional(),
  localConfidenceThreshold: z.number().min(0).max(1).nullable().optional(),
});

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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      `Validacao falhou: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }

  const before = await getEffectiveAgent(sector);
  await upsertAgentConfig(sector, parsed.data, session.user.id ?? null);
  const after = await getEffectiveAgent(sector);

  await safePublishAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id ?? session.user.email ?? "unknown",
    targetType: "agent",
    targetId: sector,
    eventType: "agent_config.updated",
    payload: {
      changes: parsed.data,
      before: {
        params: before.params,
        personaName: before.persona.name,
      },
      after: {
        params: after.params,
        personaName: after.persona.name,
      },
    },
  });

  return Response.json({
    sector: after.sector,
    persona: after.persona,
    params: after.params,
    defaults: after.defaults,
    hasOverride: after.override !== null,
    updatedAt: after.override?.updatedAt ?? null,
    updatedBy: after.override?.updatedBy ?? null,
  });
}
