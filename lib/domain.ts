export const SECTORS = [
  "desenvolvimento",
  "seguranca",
  "suporte",
  "desktop",
] as const;

export const USER_ROLES = ["user", "admin"] as const;

export type Sector = (typeof SECTORS)[number];
export type DynamicSector = string;
export type UserRole = (typeof USER_ROLES)[number];

export function isNativeSector(value: string): value is Sector {
  return (SECTORS as readonly string[]).includes(value);
}


export type ReferenceUser = {
  email: string;
  password: string;
  name: string;
  sector: Sector;
  role: UserRole;
};

export type ChatCitation = {
  sector: string;
  documentId: string;
  sourceDocumentId?: string;
  documentTitle: string;
  fileName: string;
  headingPathText: string;
  chunkIndex: number;
  score?: number;
  content?: string;
  contentPreview?: string;
};

export type DelegationTrace = {
  from: string;
  to: string;
  intent: string;
  protocol: string;
  question: string;
  answer?: string;
  status:
    | "pending"
    | "ok"
    | "timeout"
    | "bus_unavailable"
    | "protocol_violation"
    | "error";
  citations: ChatCitation[];
};

export type GenerationMetrics = {
  searchDurationMs?: number;
  ttftMs?: number;
  totalDurationMs: number;
  tokensGenerated: number;
  tokensPerSecond: number;
};
