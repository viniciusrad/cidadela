import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { prisma } from "@/lib/db/client";

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
  const status = searchParams.get("status") ?? undefined;
  const take = Math.min(Number(searchParams.get("take") ?? "20"), 50);
  const skip = Number(searchParams.get("skip") ?? "0");

  const [episodes, total] = await Promise.all([
    prisma.memoryEpisode.findMany({
      where: { sector, ...(status ? { reviewStatus: status } : {}) },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
    prisma.memoryEpisode.count({
      where: { sector, ...(status ? { reviewStatus: status } : {}) },
    }),
  ]);

  return Response.json({ episodes, total, take, skip });
}
