import type { Sector } from "@/lib/domain";

export type ChunkRow = {
  id: string | number;
  sector: Sector;
  documentId: string;
  sourceDocumentId?: string;
  documentTitle: string;
  fileName: string;
  relativePath?: string;
  headingPathText: string;
  sourceFormat: string;
  chunkIndex: number;
  contentPreview: string;
  content: string;
  contentHash?: string;
  sensitivity?: string;
  topic?: string;
  owner?: string;
  createdAt?: string;
  score?: number;
};

export type FetchResponse = {
  rows: ChunkRow[];
  nextCursor: string | null;
  totals: Record<string, number>;
  mode: "text" | "semantic";
};

export type SectorFilter = Sector | "todos";
export type SearchMode = "text" | "semantic";
export type ContentListMode = "files" | "chunks";

export type FileGroup = {
  key: string;
  sector: Sector;
  sourceDocumentId: string;
  documentTitle: string;
  fileName: string;
  relativePath?: string;
  sourceFormat: string;
  sensitivity?: string;
  topic?: string;
  owner?: string;
  loadedChunkCount: number;
  matchingChunkIndexes: number[];
  representative: ChunkRow;
};

export const PAGE_SIZE = 50;

const SENSITIVITY_LABELS: Record<string, string> = {
  public: "Publico",
  internal: "Interno",
  confidential: "Confidencial",
  restricted: "Restrito",
};

export function sensitivityLabel(value?: string) {
  if (!value) return "Publico";
  return SENSITIVITY_LABELS[value] ?? value;
}

export function sensitivityClass(value?: string) {
  if (!value || value === "public")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "internal")
    return "border-sky-200 bg-sky-50 text-sky-700";
  if (value === "confidential")
    return "border-amber-200 bg-amber-50 text-amber-800";
  if (value === "restricted")
    return "border-red-200 bg-red-50 text-red-700";
  return "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--foreground-soft)]";
}

export async function fetchChunks(params: {
  sector: SectorFilter;
  mode: SearchMode;
  q: string;
  cursor: string | null;
  limit?: number;
  sourceDocumentId?: string;
}): Promise<FetchResponse> {
  const search = new URLSearchParams({
    sector: params.sector,
    mode: params.mode,
    limit: String(params.limit ?? PAGE_SIZE),
  });
  if (params.q) search.set("q", params.q);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.sourceDocumentId)
    search.set("sourceDocumentId", params.sourceDocumentId);

  const response = await fetch(`/api/admin/chunks?${search.toString()}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(body?.message ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as FetchResponse;
}
