import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db/client";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";
import { updateDocumentTitleInQdrant } from "@/lib/qdrant";

export const runtime = "nodejs";

type PatchBody = {
  newTitle: string;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { id } = await context.params;
  if (!id) return jsonError("id obrigatorio.", 400);

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  const newTitle = body?.newTitle?.trim();
  if (!newTitle) return jsonError("newTitle obrigatorio.", 400);
  if (newTitle.length > 300)
    return jsonError("Titulo muito longo (max 300 caracteres).", 400);

  const healthy = await checkNeo4jHealth();
  if (!healthy) return jsonError("Neo4j indisponivel.", 503);

  // 1. Find the Document node to discover its sector and current title.
  const docRows = await runQuery<{
    id: string;
    sector: string;
    title: string;
    sourceDocumentId: string | null;
  }>(
    `MATCH (d:Document)
     WHERE d.id = $id OR d.sourceDocumentId = $id OR d.legacyDocumentId = $id OR elementId(d) = $id
     RETURN d.id AS id, d.sector AS sector, d.title AS title,
            d.sourceDocumentId AS sourceDocumentId
     LIMIT 1`,
    { id },
  );
  const doc = docRows[0];
  if (!doc) return jsonError("Documento nao encontrado no grafo.", 404);
  if (doc.title === newTitle)
    return jsonError("O titulo informado e igual ao atual.", 400);

  const sourceDocumentId = doc.sourceDocumentId ?? doc.id;

  // 2. Update Qdrant production payload for every chunk of this doc.
  const qdrantResult = await updateDocumentTitleInQdrant({
    sector: doc.sector,
    sourceDocumentId,
    newTitle,
  });

  // 3. Update Neo4j Document.title.
  await runQuery(
    `MATCH (d:Document)
     WHERE d.id = $id OR d.sourceDocumentId = $id OR d.legacyDocumentId = $id OR elementId(d) = $id
     SET d.title = $newTitle, d.titleUpdatedAt = datetime()`,
    { id, newTitle },
  );

  // 4. Update Postgres CurationDocument (if it exists) and mark for revision.
  let curationUpdated = false;
  let reviewCreated = false;
  try {
    const curation = await prisma.curationDocument.findFirst({
      where: {
        OR: [
          { documentId: doc.id, sector: doc.sector },
          { sourceDocumentId, sector: doc.sector },
        ],
      },
      select: { id: true, documentTitle: true },
    });

    if (curation) {
      const previousTitle = curation.documentTitle;
      await prisma.curationDocument.update({
        where: { id: curation.id },
        data: {
          documentTitle: newTitle,
          status: "NEEDS_REVISION",
        },
      });
      curationUpdated = true;

      await prisma.documentReview.create({
        data: {
          curationDocumentId: curation.id,
          reviewedById: session.user.id,
          actorType: "admin",
          questions: {
            kind: "title_rename",
            previousTitle,
            newTitle,
          },
          notes: `Titulo renomeado de "${previousTitle}" para "${newTitle}".`,
        },
      });
      reviewCreated = true;
    }
  } catch (err) {
    return Response.json(
      {
        ok: false,
        warning:
          "Qdrant e Neo4j foram atualizados, mas a curadoria falhou: " +
          (err instanceof Error ? err.message : String(err)),
        qdrantChunksUpdated: qdrantResult.updated,
        curationUpdated,
        reviewCreated,
      },
      { status: 207 },
    );
  }

  return Response.json({
    ok: true,
    documentId: doc.id,
    sourceDocumentId,
    sector: doc.sector,
    previousTitle: doc.title,
    newTitle,
    qdrantChunksUpdated: qdrantResult.updated,
    curationUpdated,
    reviewCreated,
  });
}
