export const DOCUMENT_TYPES = [
  "sop",
  "ddp",
  "norma",
  "ata",
  "doc_tecnica",
  "faq",
  "comunicado",
  "relatorio",
  "contrato",
  "conversa",
  "generico",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type ClassificationSource = "human" | "heuristic" | "llm" | "script";

export const DEFAULT_DOCUMENT_TYPE: DocumentType = "sop";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  sop: "SOP",
  ddp: "DDP",
  norma: "Norma",
  ata: "Ata",
  doc_tecnica: "Documento tecnico",
  faq: "FAQ",
  comunicado: "Comunicado",
  relatorio: "Relatorio",
  contrato: "Contrato",
  conversa: "Conversa (Teams/WhatsApp)",
  generico: "Generico",
};

export const DOCUMENT_SOURCE_TYPES: Record<DocumentType, string> = {
  sop: "sop",
  ddp: "process_description",
  norma: "policy_reference",
  ata: "meeting_record",
  doc_tecnica: "technical_reference",
  faq: "faq",
  comunicado: "announcement",
  relatorio: "report_reference",
  contrato: "contract_reference",
  conversa: "conversation",
  generico: "knowledge_note",
};

export function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" &&
    DOCUMENT_TYPES.includes(value as DocumentType)
  );
}

export function normalizeDocumentType(value: unknown): DocumentType {
  if (isDocumentType(value)) {
    return value;
  }

  return DEFAULT_DOCUMENT_TYPE;
}

export function documentTypeLabel(type: DocumentType) {
  return DOCUMENT_TYPE_LABELS[type];
}

export function sourceTypeForDocumentType(type: DocumentType) {
  return DOCUMENT_SOURCE_TYPES[type];
}
