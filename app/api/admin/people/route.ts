import { NextRequest } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { listPersons } from "@/lib/graph/people-reclassify";
import { checkNeo4jHealth } from "@/lib/neo4j";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const healthy = await checkNeo4jHealth();
  if (!healthy) return jsonError("Neo4j indisponivel.", 503);

  const sectorFilter = request.nextUrl.searchParams.get("sector");
  const persons = await listPersons(sectorFilter || null);

  return Response.json({ persons });
}
