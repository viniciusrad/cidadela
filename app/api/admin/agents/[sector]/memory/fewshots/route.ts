import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { safePublishAuditEvent } from "@/lib/bus/publisher";
import { z } from "zod";

const createSchema = z.object({
  inputPattern: z.string().min(5).max(2000),
  agentResponse: z.string().min(10).max(8000),
  domainTags: z.array(z.string().min(1).max(60)).max(10).default([]),
  score: z.number().min(0).max(1).default(1.0),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ sector: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { sector } = await context.params;
  if (!isSector(sector)) return jsonError("Setor invalido.", 400);

  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get("active") !== "false";

  const examples = await prisma.fewShotExample.findMany({
    where: { sector, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ score: "desc" }, { promotedAt: "desc" }],
  });

  return Response.json({ examples, total: examples.length });
}

export async function POST(
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      `Validacao falhou: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }

  const example = await prisma.fewShotExample.create({
    data: {
      sector,
      inputPattern: parsed.data.inputPattern,
      agentResponse: parsed.data.agentResponse,
      domainTags: parsed.data.domainTags,
      score: parsed.data.score,
      approvedBy: session.user.id ?? session.user.email ?? null,
      active: true,
    },
  });

  await safePublishAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id ?? session.user.email ?? "unknown",
    targetType: "few_shot",
    targetId: example.id,
    eventType: "few_shot.created",
    payload: { sector, inputPattern: parsed.data.inputPattern.slice(0, 120) },
  });

  return Response.json(example, { status: 201 });
}
