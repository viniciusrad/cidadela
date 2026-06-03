import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { safePublishAuditEvent } from "@/lib/bus/publisher";
import { z } from "zod";

const patchSchema = z.object({
  reviewStatus: z.enum(["approved", "rejected"]),
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

  const episode = await prisma.memoryEpisode.findUnique({ where: { id } });
  if (!episode || episode.sector !== sector)
    return jsonError("Episodio nao encontrado.", 404);

  const updated = await prisma.memoryEpisode.update({
    where: { id },
    data: {
      reviewStatus: parsed.data.reviewStatus,
      reviewedBy: session.user.id ?? session.user.email ?? null,
    },
  });

  await safePublishAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id ?? session.user.email ?? "unknown",
    targetType: "memory_episode",
    targetId: id,
    eventType: "memory_episode.reviewed",
    payload: { reviewStatus: parsed.data.reviewStatus, sector },
  });

  return Response.json(updated);
}
