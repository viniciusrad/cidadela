import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    all?: unknown;
  };
  const now = new Date();

  if (body.all === true) {
    const result = await prisma.notification.updateMany({
      where: { userId: session.user.id, readAt: null },
      data: { readAt: now },
    });
    return Response.json({ updated: result.count });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return jsonError("Informe id ou all=true.");
  }

  const result = await prisma.notification.updateMany({
    where: { id, userId: session.user.id, readAt: null },
    data: { readAt: now },
  });

  return Response.json({ updated: result.count });
}
