import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { safePublishAuditEvent } from "@/lib/bus/publisher";
import { z } from "zod";

const patchSchema = z.object({
  active: z.boolean().optional(),
  score: z.number().min(0).max(1).optional(),
  domainTags: z.array(z.string().min(1).max(60)).max(10).optional(),
  inputPattern: z.string().min(5).max(2000).optional(),
  agentResponse: z.string().min(10).max(8000).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sector: string; id: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { sector, id } = await context.params;
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

  const existing = await prisma.fewShotExample.findUnique({ where: { id } });
  if (!existing || existing.sector !== sector)
    return jsonError("Exemplo nao encontrado.", 404);

  const updated = await prisma.fewShotExample.update({
    where: { id },
    data: parsed.data,
  });

  await safePublishAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id ?? session.user.email ?? "unknown",
    targetType: "few_shot",
    targetId: id,
    eventType: "few_shot.updated",
    payload: { changes: parsed.data, sector },
  });

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sector: string; id: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { sector, id } = await context.params;
  if (!isSector(sector)) return jsonError("Setor invalido.", 400);

  const existing = await prisma.fewShotExample.findUnique({ where: { id } });
  if (!existing || existing.sector !== sector)
    return jsonError("Exemplo nao encontrado.", 404);

  await prisma.fewShotExample.delete({ where: { id } });

  await safePublishAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id ?? session.user.email ?? "unknown",
    targetType: "few_shot",
    targetId: id,
    eventType: "few_shot.deleted",
    payload: { sector },
  });

  return new Response(null, { status: 204 });
}
