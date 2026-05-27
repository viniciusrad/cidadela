import type {
  ConsolidationArtifactType,
  ConsolidationDocumentRef,
  ConsolidationEvidenceChunk,
  ConsolidationSourceScope,
} from "@/lib/consolidation";

export function artifactLabel(type: ConsolidationArtifactType) {
  return type === "sop" ? "SOP" : "DDP";
}

export function sourceScopeLabel(scope: ConsolidationSourceScope) {
  if (scope === "promoted") return "Publicados";
  if (scope === "staging") return "Em revisao";
  return "Ambos";
}

export function previewProgressLabel(progress: number) {
  if (progress < 30) return "Buscando evidencias";
  if (progress < 60) return "Consolidando sinais do processo";
  if (progress < 90) return "Montando a previa do artefato";
  return "Finalizando previa";
}

export function documentKey(doc: ConsolidationDocumentRef) {
  return `${doc.sector}:${doc.source}:${doc.sourceDocumentId}`;
}

export function chunkKey(chunk: ConsolidationEvidenceChunk) {
  return `${chunk.sector}:${chunk.source}:${chunk.sourceDocumentId}:${chunk.chunkIndex}`;
}
