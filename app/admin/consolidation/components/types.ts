import type {
  ConsolidationArtifactType,
  ConsolidationClarificationQuestion,
  ConsolidationPreview,
} from "@/lib/consolidation";

export type PreviewState = ConsolidationPreview & {
  status: "ready" | "preview-loading" | "draft-sending" | "needs-clarification";
  message?: string;
  isError?: boolean;
  progress?: number;
  progressLabel?: string;
  clarificationQuestions?: ConsolidationClarificationQuestion[];
  clarificationAnswers?: Record<string, string>;
};

export type CandidateSelectionState = {
  selectedDocumentKeys: string[];
  selectedChunkKeys: string[];
};

export const ALL_SECTOR = "all";
