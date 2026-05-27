import { z } from "zod";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db/client";
import { SECTORS } from "@/lib/domain";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await auth();

  if (!session?.user) {
    return { error: jsonError("Nao autenticado.", 401) };
  }

  if (session.user.role !== "admin") {
    return { error: jsonError("Acesso restrito a administradores.", 403) };
  }

  return { session };
}

const ownerSchema = z.object({
  id: z.string().min(1).optional(),
  topic: z.string().min(1).max(120).transform((value) => value.trim()),
  sector: z.enum(SECTORS),
  userEmail: z.string().email().max(240).transform((value) => value.trim()),
});

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) {
    return guard.error;
  }

  const [owners, topics] = await Promise.all([
    prisma.knowledgeOwner.findMany({
      orderBy: [{ sector: "asc" }, { topic: "asc" }],
    }),
    prisma.curationDocument.findMany({
      where: {
        topic: { not: null },
      },
      distinct: ["topic", "sector"],
      orderBy: [{ sector: "asc" }, { topic: "asc" }],
      select: {
        topic: true,
        sector: true,
      },
    }),
  ]);

  return Response.json({
    owners,
    topics: topics
      .filter((item): item is { topic: string; sector: string } =>
        Boolean(item.topic),
      )
      .map((item) => ({ topic: item.topic, sector: item.sector })),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) {
    return guard.error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corpo invalido.", 400);
  }

  const parsed = ownerSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      `Validacao falhou: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      400,
    );
  }

  try {
    const data = parsed.data;
    const owner = data.id
      ? await prisma.knowledgeOwner.update({
          where: { id: data.id },
          data: {
            topic: data.topic,
            sector: data.sector,
            userEmail: data.userEmail,
          },
        })
      : await prisma.knowledgeOwner.upsert({
          where: {
            topic_sector: {
              topic: data.topic,
              sector: data.sector,
            },
          },
          create: {
            topic: data.topic,
            sector: data.sector,
            userEmail: data.userEmail,
          },
          update: {
            userEmail: data.userEmail,
          },
        });

    return Response.json({ owner });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Nao foi possivel salvar o dono do conhecimento.",
      400,
    );
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) {
    return guard.error;
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return jsonError("Parametro id e obrigatorio.", 400);
  }

  await prisma.knowledgeOwner.delete({ where: { id } });

  return Response.json({ ok: true });
}
