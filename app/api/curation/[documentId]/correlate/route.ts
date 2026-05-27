import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { correlationGateFromRun, runDocumentCorrelation } from "@/lib/curation/correlation";
import { findCurationDocumentForActor } from "@/lib/curation/documents";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { documentId } = await context.params;
  const document = await findCurationDocumentForActor(documentId, session.user);

  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  if (document.status === "PROMOTED" || document.status === "REJECTED") {
    return jsonError("Documento encerrado nao pode ser recorrelacionado.", 409);
  }

  const run = await runDocumentCorrelation({
    document,
    actorId: session.user.id,
    traceId: randomUUID(),
  });

  return Response.json({
    correlationGate: correlationGateFromRun(run),
  });
}
