import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { SECTORS, type Sector } from "@/lib/domain";
import { getEmbedding } from "@/lib/ollama";
import { normalizeSensitivity } from "@/lib/sensitivity";
import {
  listSectorChunks,
  semanticSearchSectorChunks,
  type AdminChunkRow,
} from "@/lib/qdrant";

export const runtime = "nodejs";

type CursorMap = Partial<Record<Sector, string | number>>;

async function enrichRowsWithDocumentSensitivity(rows: AdminChunkRow[]) {
  const rowsMissingSensitivity = rows.filter((row) => !row.sensitivity);

  if (rowsMissingSensitivity.length === 0) {
    return rows;
  }

  const documents = await prisma.curationDocument.findMany({
    where: {
      OR: rowsMissingSensitivity.map((row) => ({
        sector: row.sector,
        sourceDocumentId: row.sourceDocumentId ?? row.documentId,
      })),
    },
    select: {
      sector: true,
      sourceDocumentId: true,
      sensitivity: true,
      topic: true,
      owner: true,
    },
  });

  const metadataByKey = new Map(
    documents.map((document) => [
      `${document.sector}:${document.sourceDocumentId}`,
      document,
    ]),
  );

  return rows.map((row) => {
    if (row.sensitivity) {
      return row;
    }

    const metadata = metadataByKey.get(
      `${row.sector}:${row.sourceDocumentId ?? row.documentId}`,
    );

    if (!metadata) {
      return {
        ...row,
        sensitivity: normalizeSensitivity(row.sensitivity),
      };
    }

    return {
      ...row,
      sensitivity: normalizeSensitivity(metadata.sensitivity),
      topic: row.topic ?? metadata.topic ?? undefined,
      owner: row.owner ?? metadata.owner ?? undefined,
    };
  });
}

function parseCursor(raw: string | null): CursorMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: CursorMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        isSector(key) &&
        (typeof value === "string" || typeof value === "number")
      ) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function encodeCursor(cursor: CursorMap): string | null {
  const entries = Object.entries(cursor).filter(
    ([, v]) => v !== null && v !== undefined,
  );
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  const url = new URL(request.url);
  const rawSector = url.searchParams.get("sector") ?? "todos";
  const mode = url.searchParams.get("mode") === "semantic" ? "semantic" : "text";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const sourceDocumentId = url.searchParams.get("sourceDocumentId")?.trim() || "";
  const limit = Math.max(
    1,
    Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200),
  );
  const incomingCursor = parseCursor(url.searchParams.get("cursor"));
  const isFirstPage = !url.searchParams.get("cursor");

  let targetSectors: Sector[];
  if (rawSector === "todos") {
    targetSectors = [...SECTORS];
  } else if (isSector(rawSector)) {
    targetSectors = [rawSector];
  } else {
    return jsonError("Setor invalido.", 400);
  }

  if (mode === "semantic") {
    if (!q) {
      return jsonError(
        "Busca semantica exige um termo em 'q'.",
        400,
      );
    }

    const vector = await getEmbedding(q);
    const perSectorLimit =
      targetSectors.length === 1 ? limit : Math.max(1, Math.floor(limit / targetSectors.length));

    const rows: AdminChunkRow[] = [];
    const totals: Record<string, number> = {};

    for (const sector of targetSectors) {
      const result = await semanticSearchSectorChunks(sector, vector, {
        limit: perSectorLimit,
      });
      rows.push(...result.rows);
      totals[sector] = result.total;
    }

    const enrichedRows = await enrichRowsWithDocumentSensitivity(rows);
    enrichedRows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return Response.json({
      rows: enrichedRows,
      nextCursor: null,
      totals,
      mode: "semantic",
    });
  }

  const rows: AdminChunkRow[] = [];
  const nextCursor: CursorMap = {};
  const totals: Record<string, number> = {};

  for (const sector of targetSectors) {
    const offsetForSector = incomingCursor[sector];
    if (!isFirstPage && offsetForSector === undefined) {
      continue;
    }

    const perSectorLimit =
      targetSectors.length === 1 ? limit : Math.max(1, Math.floor(limit / targetSectors.length));

      const result = await listSectorChunks(sector, {
        limit: perSectorLimit,
        offset: offsetForSector ?? null,
        textQuery: q || undefined,
        sourceDocumentId: sourceDocumentId || undefined,
      });

    rows.push(...result.rows);
    totals[sector] = result.total;

    if (result.nextOffset !== null) {
      nextCursor[sector] = result.nextOffset;
    }
  }

  return Response.json({
    rows: await enrichRowsWithDocumentSensitivity(rows),
    nextCursor: encodeCursor(nextCursor),
    totals,
    mode: "text",
  });
}
