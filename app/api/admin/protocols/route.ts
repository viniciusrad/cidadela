import { randomUUID } from "node:crypto";
import { z } from "zod";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { PROTOCOLS } from "@/lib/agents/protocols";
import {
  resetProtocol,
  updateProtocol,
} from "@/lib/agents/config-repo";
import { getEffectiveProtocols } from "@/lib/agents/effective";
import { safePublishAuditEvent } from "@/lib/bus/publisher";

export const runtime = "nodejs";

const sectorSchema = z.string().refine(isSector, { message: "Setor invalido." });

const patchSchema = z.object({
  from: sectorSchema,
  to: sectorSchema,
  intent: z.string().min(1).max(80),
  enabled: z.boolean().optional(),
  template: z.string().min(1).max(4000).optional(),
  maxTokens: z.number().int().min(32).max(4096).optional(),
  reset: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

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

  const { from, to, intent, reset, ...changes } = parsed.data;

  if (reset) {
    const baseline = PROTOCOLS.find(
      (p) => p.from === from && p.to === to && p.intent === intent,
    );
    if (!baseline) return jsonError("Protocolo nao encontrado.", 404);
    await resetProtocol(from, to, intent, {
      enabled: baseline.enabled,
      template: baseline.template,
      maxTokens: baseline.maxTokens,
    });
  } else {
    if (Object.keys(changes).length === 0) {
      return jsonError("Nenhum campo para atualizar.", 400);
    }
    await updateProtocol(from, to, intent, changes);
  }

  const all = await getEffectiveProtocols();
  const after = all.find(
    (p) => p.from === from && p.to === to && p.intent === intent,
  );

  await safePublishAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id ?? session.user.email ?? "unknown",
    targetType: "protocol",
    targetId: `${from}->${to}:${intent}`,
    eventType: reset ? "protocol_config.reset" : "protocol_config.updated",
    payload: { changes },
  });

  return Response.json({
    protocol: after
      ? {
          id: after.id,
          from: after.from,
          to: after.to,
          intent: after.intent,
          template: after.template,
          maxTokens: after.maxTokens,
          enabled: after.enabled,
        }
      : null,
  });
}
