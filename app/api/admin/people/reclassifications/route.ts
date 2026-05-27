import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { listRecentReclassifications } from "@/lib/graph/people-reclassify";
import { checkNeo4jHealth } from "@/lib/neo4j";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const healthy = await checkNeo4jHealth();
  if (!healthy) return jsonError("Neo4j indisponivel.", 503);

  const items = await listRecentReclassifications(50);
  return Response.json({ items });
}
