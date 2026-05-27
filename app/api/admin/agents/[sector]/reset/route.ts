import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { resetAgentConfig } from "@/lib/agents/config-repo";
import { getEffectiveAgent } from "@/lib/agents/effective";
import { safePublishAuditEvent } from "@/lib/bus/publisher";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ sector: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { sector } = await context.params;
  if (!isSector(sector)) return jsonError("Setor invalido.", 400);

  await resetAgentConfig(sector);
  const after = await getEffectiveAgent(sector);

  await safePublishAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id ?? session.user.email ?? "unknown",
    targetType: "agent",
    targetId: sector,
    eventType: "agent_config.reset",
    payload: {},
  });

  return Response.json({
    sector: after.sector,
    persona: after.persona,
    params: after.params,
    defaults: after.defaults,
    hasOverride: false,
    updatedAt: null,
    updatedBy: null,
  });
}
