"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SECTORS, type Sector, type UserRole } from "@/lib/domain";
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
} from "@/lib/document-types";
import { getSectorLabel, SECTOR_LABELS } from "@/lib/labels";

type InitialCurationDocument = {
  id: string;
  documentId: string;
  documentTitle: string;
  fileName: string;
  owner: string | null;
  sector: string;
  sopReadinessScore: number | null;
  curationReadinessScore?: number | null;
  documentType?: DocumentType | null;
  status: string;
  topic: string | null;
  uploadedAt: string;
};

type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  sector: Sector;
};

type SectorOption = {
  slug: string;
  displayName: string;
  agentName: string;
};

type CurationQuestion = {
  id: string;
  type: string;
  prompt: string;
  required: boolean;
  response?: string;
  isDefault?: boolean;
  source?: "template" | "inferred" | "process_gap";
};

type CurationApproval = {
  id: string;
  approverRole: string;
  decision: string;
  reason?: string | null;
  createdAt: string;
};

type ApprovalGate = {
  requiresOwnerApproval: boolean;
  requiresAdminApproval: boolean;
  allowSameUserDualApproval: boolean;
  hasOwnerApproval: boolean;
  hasAdminApproval: boolean;
  hasAnyApproval: boolean;
  missingApprovals: Array<"owner" | "admin">;
  canPromote: boolean;
};

type CorrelationFinding = {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "resolved" | "dismissed";
  stagedChunkIndex: number;
  stagedHeadingPathText: string;
  stagedContentPreview: string;
  relatedChunk: {
    documentId: string;
    sourceDocumentId?: string;
    documentTitle: string;
    fileName: string;
    headingPathText: string;
    chunkIndex: number;
    score: number;
    contentPreview: string;
  };
  issue: string;
  question: string;
  recommendation?: string;
  resolution?: {
    answer: string;
    decision: string;
    resolvedAt: string;
    revisedChunkPreview?: string;
  };
};

type CorrelationGate = {
  runId?: string;
  status: "NOT_RUN" | "PASSED" | "BLOCKED" | string;
  createdAt?: string;
  summary?: string | null;
  findings: CorrelationFinding[];
  blockingFindings: CorrelationFinding[];
  canApprove: boolean;
};

type CurationChunk = {
  id: string | number;
  chunkIndex: number;
  documentTitle: string;
  fileName: string;
  headingPathText: string;
  contentPreview: string;
  content: string;
  contentHash?: string;
  createdAt?: string;
};

type QueueTab = "queue" | "approved" | "rejected";

const SENSITIVITY_OPTIONS = [
  { value: "internal", label: "Interno — uso restrito ao time" },
  { value: "public", label: "Público — pode ser compartilhado externamente" },
  { value: "confidential", label: "Confidencial — acesso controlado" },
  { value: "restricted", label: "Restrito — alta sensibilidade" },
] as const;

const SENSITIVITY_LABELS: Record<string, string> = {
  internal: "Interno",
  public: "Público",
  confidential: "Confidencial",
  restricted: "Restrito",
};

type ImprovementSource = {
  sector: string;
  documentId: string;
  documentTitle: string;
  fileName: string;
  headingPathText: string;
  chunkIndex: number;
  score: number;
  content: string;
  contentPreview: string;
};

type ImprovementEvent =
  | { type: "chunk"; data: { text: string } }
  | { type: "done" }
  | { type: "error"; message: string };

type CurationDetail = {
  document: InitialCurationDocument & {
    id: string;
    sourceDocumentId: string;
    relativePath?: string | null;
    sourceFormat: string;
    sensitivity?: string | null;
    effectiveFrom?: string | null;
    sopPath?: string | null;
    classificationSource?: string | null;
    classificationConfidence?: number | null;
    authorityLevel?: string | null;
    uploaderEmail?: string | null;
    normalizedMarkdown: string;
  };
  chunks: CurationChunk[];
  questions: CurationQuestion[];
  correlationGate: CorrelationGate;
  approvalGate: ApprovalGate;
  approvals: CurationApproval[];
};

function readinessPercent(score: number | null | undefined) {
  return typeof score === "number" ? Math.round(score * 100) : null;
}

function statusClassName(status: string) {
  if (status === "APPROVED" || status === "PROMOTED") {
    return "bg-emerald-400/15 text-emerald-700";
  }

  if (status === "READY_FOR_APPROVAL") {
    return "bg-[var(--accent-soft)] text-[var(--accent)]";
  }

  if (status === "NEEDS_REVISION" || status === "REJECTED") {
    return "bg-red-500/15 text-red-700";
  }

  return "bg-[var(--surface-muted)] text-[var(--foreground-soft)]";
}

function severityClassName(severity: CorrelationFinding["severity"]) {
  if (severity === "critical") {
    return "bg-red-600 text-white";
  }

  if (severity === "high") {
    return "bg-red-500/15 text-red-700";
  }

  if (severity === "medium") {
    return "bg-amber-400/20 text-amber-800";
  }

  return "bg-[var(--surface-muted)] text-[var(--foreground-soft)]";
}

function normalizeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getQueueTabForStatus(status: string): QueueTab {
  if (status === "REJECTED") {
    return "rejected";
  }

  if (status === "APPROVED" || status === "PROMOTED") {
    return "approved";
  }

  return "queue";
}

function pickQueueTab(documents: InitialCurationDocument[]): QueueTab {
  if (documents.some((document) => getQueueTabForStatus(document.status) === "queue")) {
    return "queue";
  }

  if (
    documents.some((document) => getQueueTabForStatus(document.status) === "approved")
  ) {
    return "approved";
  }

  return "rejected";
}

function firstDocumentIdForTab(
  documents: InitialCurationDocument[],
  tab: QueueTab,
) {
  return (
    documents.find((document) => getQueueTabForStatus(document.status) === tab)
      ?.id ?? ""
  );
}

export function CurationReviewWorkbench({
  documents,
  sectorOptions,
  user,
  selectedSector = "todos",
}: {
  documents: InitialCurationDocument[];
  sectorOptions: SectorOption[];
  user: SessionUser;
  selectedSector?: string;
}) {
  const router = useRouter();
  const initialQueueTab = pickQueueTab(documents);
  const [previousDocuments, setPreviousDocuments] = useState(documents);
  const [documentRows, setDocumentRows] = useState(documents);
  const [queueTab, setQueueTab] = useState<QueueTab>(initialQueueTab);
  const [stagingViewTab, setStagingViewTab] = useState<"full" | "chunks">("full");
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    firstDocumentIdForTab(documents, initialQueueTab),
  );
  const [detail, setDetail] = useState<CurationDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [correlationAnswers, setCorrelationAnswers] = useState<
    Record<string, string>
  >({});
  const autoCorrelationIdsRef = useRef<Record<string, boolean>>({});
  const detailRequestIdRef = useRef(0);
  const [editingQuestionIds, setEditingQuestionIds] = useState<
    Record<string, boolean>
  >({});
  const [approvalReason, setApprovalReason] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [isDiscardModalOpen, setIsDiscardModalOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [improvementOpen, setImprovementOpen] = useState(false);
  const [improvementPhase, setImprovementPhase] = useState<"config" | "searching" | "select" | "running" | "review">("config");
  const [improvementLimit, setImprovementLimit] = useState(3);
  const [improvementSuggestion, setImprovementSuggestion] = useState("");
  const [improvementEdited, setImprovementEdited] = useState("");
  const [improvementSources, setImprovementSources] = useState<ImprovementSource[]>([]);
  const [improvementCandidates, setImprovementCandidates] = useState<ImprovementSource[]>([]);
  const [improvementSelectedIds, setImprovementSelectedIds] = useState<Set<string>>(new Set());
  const [improvementSourcesOpen, setImprovementSourcesOpen] = useState(false);
  const [isApplyingImprovement, setIsApplyingImprovement] = useState(false);
  const [isEditingDocumentContent, setIsEditingDocumentContent] = useState(false);
  const [documentContentDraft, setDocumentContentDraft] = useState("");
  const [isSavingDocumentContent, setIsSavingDocumentContent] = useState(false);
  const availableSectorOptions = useMemo(
    () =>
      sectorOptions.length > 0
        ? sectorOptions
        : SECTORS.map((sector) => ({
            slug: sector,
            displayName: SECTOR_LABELS[sector],
            agentName: SECTOR_LABELS[sector],
          })),
    [sectorOptions],
  );
  const availableSectorSlugs = useMemo(
    () => availableSectorOptions.map((sector) => sector.slug),
    [availableSectorOptions],
  );
  const sectorLabelBySlug = useMemo(
    () =>
      new Map(
        availableSectorOptions.map((sector) => [sector.slug, sector.displayName]),
      ),
    [availableSectorOptions],
  );
  const candidateSectorSlugs = useMemo(() => {
    const candidateSlugs = new Set(improvementCandidates.map((candidate) => candidate.sector));
    const orderedKnown = availableSectorSlugs.filter((sector) =>
      candidateSlugs.has(sector),
    );
    const unknown = [...candidateSlugs].filter(
      (sector) => !availableSectorSlugs.includes(sector),
    );
    return [...orderedKnown, ...unknown.sort()];
  }, [availableSectorSlugs, improvementCandidates]);

  if (documents !== previousDocuments) {
    const nextTab = pickQueueTab(documents);
    setPreviousDocuments(documents);
    setDocumentRows(documents);
    setQueueTab(nextTab);
    setSelectedDocumentId(firstDocumentIdForTab(documents, nextTab));
  }

  const queueRows = useMemo(
    () => documentRows.filter((d) => getQueueTabForStatus(d.status) === "queue"),
    [documentRows],
  );
  const approvedRows = useMemo(
    () => documentRows.filter((d) => getQueueTabForStatus(d.status) === "approved"),
    [documentRows],
  );
  const rejectedRows = useMemo(
    () => documentRows.filter((d) => getQueueTabForStatus(d.status) === "rejected"),
    [documentRows],
  );
  const visibleRows =
    queueTab === "approved"
      ? approvedRows
      : queueTab === "rejected"
        ? rejectedRows
        : queueRows;

  const selectedDocument = useMemo(
    () =>
      documentRows.find((document) => document.id === selectedDocumentId) ??
      null,
    [documentRows, selectedDocumentId],
  );

  const stagingChunks = detail?.chunks;
  const templateQuestions =
    detail?.questions.filter(
      (question) => !question.source || question.source === "template",
    ) ?? [];
  const inferredQuestions =
    detail?.questions.filter((question) => question.source === "inferred") ?? [];
  const processGapQuestions =
    detail?.questions.filter((question) => question.source === "process_gap") ?? [];
  const consolidatedStagingContent = useMemo(() => {
    if (!stagingChunks || stagingChunks.length === 0) {
      return "";
    }

    return [...stagingChunks]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((chunk) => {
        const heading = chunk.headingPathText?.trim() || `Trecho ${chunk.chunkIndex + 1}`;
        const content = chunk.content.trim();

        return `### ${heading}\n\n${content}`;
      })
      .join("\n\n");
  }, [stagingChunks]);
  const answeredQuestionCount = templateQuestions.filter((question) =>
    question.response?.trim(),
  ).length;
  const defaultAnswerCount = templateQuestions.filter(
    (question) => question.isDefault && question.response?.trim(),
  ).length;
  const readiness = readinessPercent(
    detail?.document.curationReadinessScore ?? detail?.document.sopReadinessScore,
  );
  const correlationAllowsApproval = detail?.correlationGate.canApprove === true;
  const canApprove =
    correlationAllowsApproval &&
    detail?.document.status !== "PROMOTED" &&
    detail?.document.status !== "REJECTED";
  const isPromoted = detail?.document.status === "PROMOTED";
  const canEditAnswers = detail?.document.status !== "PROMOTED";
  const approvalGate = detail?.approvalGate;
  const canPromote =
    correlationAllowsApproval &&
    detail?.document.status === "APPROVED" &&
    approvalGate?.canPromote === true;
  const canApproveMissingAndPromote =
    user.role === "admin" &&
    canApprove &&
    approvalGate !== undefined &&
    approvalGate.hasAnyApproval === false;
  const promoteBlocker =
    isPromoted
      ? "Documento ja publicado no chat."
      : detail?.correlationGate.canApprove === false
      ? detail.correlationGate.status === "NOT_RUN"
        ? "Compare com o conteudo ja publicado antes de aprovar."
        : "Resolva achados high/critical da correlacao antes de aprovar."
      : detail?.document.status !== "APPROVED"
      ? "Promote exige status APPROVED. Registre as aprovacoes pendentes primeiro."
      : approvalGate?.canPromote === false
        ? "Falta uma aprovacao do dono ou de um admin."
        : "";

  const updateDocumentStatus = useCallback(
    (documentId: string, update: Partial<InitialCurationDocument>) => {
      setDocumentRows((current) =>
        current.map((document) =>
          document.id === documentId ? { ...document, ...update } : document,
        ),
      );
    },
    [],
  );

  const removeDocumentFromState = useCallback((documentId: string) => {
    setDocumentRows((current) =>
      current.filter((document) => document.id !== documentId),
    );
  }, []);

  const selectQueueDocument = useCallback(
    (tab: QueueTab) => {
      setQueueTab(tab);

      const rows =
        tab === "approved" ? approvedRows : tab === "rejected" ? rejectedRows : queueRows;
      setSelectedDocumentId(rows[0]?.id ?? "");
    },
    [approvedRows, queueRows, rejectedRows, setQueueTab, setSelectedDocumentId],
  );

  const loadDetail = useCallback(async (documentId: string) => {
    if (!documentId) {
      setDetail(null);
      return;
    }

    const requestId = ++detailRequestIdRef.current;
    setIsLoadingDetail(true);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(`/api/curation/${documentId}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as CurationDetail & {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar documento.");
      }

      if (requestId !== detailRequestIdRef.current) {
        return;
      }

      setDetail(payload);
      setStagingViewTab("full");
      setIsEditingDocumentContent(false);
      setDocumentContentDraft(payload.document.normalizedMarkdown);

      const baseAnswers = Object.fromEntries(
        payload.questions.map((question) => [question.id, question.response ?? ""]),
      );

      // Pré-preencher campos de metadados sem resposta ainda
      const smartDefaults: Record<string, string> = {};
      for (const question of payload.questions) {
        if (question.response?.trim()) continue;

        if (question.id === "metadata_owner" && payload.document.uploaderEmail) {
          smartDefaults[question.id] = payload.document.uploaderEmail;
        } else if (question.id === "metadata_title" && payload.document.documentTitle) {
          smartDefaults[question.id] = payload.document.documentTitle;
        } else if (question.id === "metadata_sensitivity") {
          smartDefaults[question.id] = "internal";
        } else if (question.id === "metadata_effective_from") {
          const d = new Date();
          d.setFullYear(d.getFullYear() + 1);
          smartDefaults[question.id] = d.toISOString().slice(0, 10);
        }
      }

      setAnswers({ ...baseAnswers, ...smartDefaults });
      setCorrelationAnswers(
        Object.fromEntries(
          payload.correlationGate.findings.map((finding) => [
            finding.id,
            finding.resolution?.answer ?? "",
          ]),
        ),
      );
      setEditingQuestionIds({});
      updateDocumentStatus(documentId, {
        owner: payload.document.owner,
        sopReadinessScore: payload.document.sopReadinessScore,
        curationReadinessScore: payload.document.curationReadinessScore,
        documentType: payload.document.documentType,
        status: payload.document.status,
        topic: payload.document.topic,
      });
    } catch (error) {
      if (requestId !== detailRequestIdRef.current) {
        return;
      }

      setDetail(null);
      setErrorMessage(normalizeError(error, "Falha ao carregar documento."));
    } finally {
      if (requestId === detailRequestIdRef.current) {
        setIsLoadingDetail(false);
      }
    }
  }, [updateDocumentStatus]);

  const runCorrelation = useCallback(
    async (documentId: string, automatic = false) => {
      if (!documentId) return;

      setPendingAction("correlate");
      setErrorMessage("");
      if (!automatic) {
        setMessage("");
      }

      try {
        const response = await fetch(`/api/curation/${documentId}/correlate`, {
          method: "POST",
        });
        const payload = (await response.json()) as {
          message?: string;
          correlationGate?: CorrelationGate;
        };

        if (!response.ok || !payload.correlationGate) {
          throw new Error(payload.message ?? "Falha ao executar correlacao.");
        }

        const correlationGate = payload.correlationGate;
        setDetail((current) =>
          current
            ? {
                ...current,
                correlationGate,
              }
            : current,
        );
        setCorrelationAnswers(
          Object.fromEntries(
            correlationGate.findings.map((finding) => [
              finding.id,
              finding.resolution?.answer ?? "",
            ]),
          ),
        );
        setMessage(
          correlationGate.blockingFindings.length > 0
            ? "Correlacao concluida com achados obrigatorios para validacao."
            : "Correlacao concluida sem bloqueios high/critical.",
        );
      } catch (error) {
        setErrorMessage(normalizeError(error, "Falha ao executar correlacao."));
      } finally {
        setPendingAction("");
      }
    },
    [],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDetail(selectedDocumentId);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadDetail, selectedDocumentId]);

  useEffect(() => {
    if (
      !detail ||
      detail.correlationGate.status !== "NOT_RUN" ||
      detail.document.status === "PROMOTED" ||
      detail.document.status === "REJECTED" ||
      autoCorrelationIdsRef.current[detail.document.id] ||
      pendingAction
    ) {
      return;
    }

    autoCorrelationIdsRef.current[detail.document.id] = true;
    void runCorrelation(detail.document.id, true);
  }, [detail, pendingAction, runCorrelation]);

  const submitAnswer = async (questionId: string) => {
    if (!selectedDocumentId) return;

    const responseText = answers[questionId]?.trim() ?? "";
    if (!responseText) {
      setErrorMessage("Preencha a resposta antes de validar este item.");
      return;
    }

    setPendingAction(`answer:${questionId}`);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(`/api/curation/${selectedDocumentId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, response: responseText }),
      });
      const payload = (await response.json()) as {
        message?: string;
        status?: string;
        sopReadinessScore?: number;
        curationReadinessScore?: number;
        questions?: CurationQuestion[];
        approvalsInvalidated?: boolean;
        approvalGate?: ApprovalGate;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao validar resposta.");
      }

      setMessage(
        payload.approvalsInvalidated
          ? "Resposta atualizada, prontidao recalculada e aprovacoes anteriores invalidadas."
          : "Resposta registrada e prontidao recalculada.",
      );
      setEditingQuestionIds((current) => ({
        ...current,
        [questionId]: false,
      }));
      setDetail((current) =>
        current
          ? {
              ...current,
              document: {
                ...current.document,
                status: payload.status ?? current.document.status,
                sopReadinessScore:
                  payload.sopReadinessScore ?? current.document.sopReadinessScore,
                curationReadinessScore:
                  payload.curationReadinessScore ??
                  current.document.curationReadinessScore,
              },
              questions: payload.questions ?? current.questions,
              approvals: payload.approvalsInvalidated ? [] : current.approvals,
              approvalGate: payload.approvalGate ?? current.approvalGate,
            }
          : current,
      );
      updateDocumentStatus(selectedDocumentId, {
        status: payload.status ?? selectedDocument?.status,
        sopReadinessScore:
          payload.sopReadinessScore ?? selectedDocument?.sopReadinessScore,
        curationReadinessScore:
          payload.curationReadinessScore ??
          selectedDocument?.curationReadinessScore,
      });
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao validar resposta."));
    } finally {
      setPendingAction("");
    }
  };

  const resolveCorrelation = async (
    findingId: string,
    decision: "validated" | "dismissed" | "revised_staging",
  ) => {
    if (!selectedDocumentId) return;

    const answer = correlationAnswers[findingId]?.trim() ?? "";
    if (!answer) {
      setErrorMessage("Responda o achado de correlacao antes de resolver.");
      return;
    }

    setPendingAction(`correlation:${findingId}:${decision}`);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/curation/${selectedDocumentId}/correlation/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ findingId, answer, decision }),
        },
      );
      const payload = (await response.json()) as {
        message?: string;
        correlationGate?: CorrelationGate;
        approvalsInvalidated?: boolean;
        status?: string;
        sopReadinessScore?: number;
        curationReadinessScore?: number;
      };

      if (!response.ok || !payload.correlationGate) {
        throw new Error(payload.message ?? "Falha ao resolver correlacao.");
      }

      const correlationGate = payload.correlationGate;
      setDetail((current) =>
        current
          ? {
              ...current,
              document: {
                ...current.document,
                status: payload.approvalsInvalidated
                  ? payload.status ?? "NEEDS_REVISION"
                  : current.document.status,
                sopReadinessScore:
                  payload.sopReadinessScore ?? current.document.sopReadinessScore,
                curationReadinessScore:
                  payload.curationReadinessScore ??
                  current.document.curationReadinessScore,
              },
              approvals: payload.approvalsInvalidated ? [] : current.approvals,
              correlationGate,
            }
          : current,
      );
      updateDocumentStatus(selectedDocumentId, {
        status: payload.approvalsInvalidated
          ? payload.status ?? "NEEDS_REVISION"
          : selectedDocument?.status,
        sopReadinessScore:
          payload.sopReadinessScore ?? selectedDocument?.sopReadinessScore,
        curationReadinessScore:
          payload.curationReadinessScore ??
          selectedDocument?.curationReadinessScore,
      });
      setMessage(
        payload.approvalsInvalidated
          ? "Achado resolvido, documento em revisao ajustado e aprovacoes anteriores invalidadas."
          : "Achado de correlacao resolvido.",
      );
      if (decision === "revised_staging") {
        await loadDetail(selectedDocumentId);
      }
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao resolver correlacao."));
    } finally {
      setPendingAction("");
    }
  };

  const postApproval = async (role: "owner" | "admin") => {
    const response = await fetch(`/api/curation/${selectedDocumentId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          decision: "approved",
          reason: approvalReason.trim() || undefined,
        }),
      });
    const payload = (await response.json()) as {
        message?: string;
        status?: string;
      };

    if (!response.ok) {
      throw new Error(payload.message ?? "Falha ao registrar aprovacao.");
    }

    return payload;
  };

  const postPromote = async () => {
    const response = await fetch(`/api/curation/${selectedDocumentId}/promote`, {
      method: "POST",
    });
    const payload = (await response.json()) as {
      chunksCreated?: number;
      message?: string;
      sopPath?: string;
      status?: string;
    };

    if (!response.ok) {
      throw new Error(payload.message ?? "Falha ao publicar documento.");
    }

    return payload;
  };

  const applyPromotePayload = (payload: {
    chunksCreated?: number;
    sopPath?: string;
    status?: string;
  }) => {
    const nextStatus = payload.status ?? "PROMOTED";
    setMessage(
      `Documento publicado no chat com ${payload.chunksCreated ?? 0} trecho(s) de procedimento.`,
    );
    updateDocumentStatus(selectedDocumentId, {
      status: nextStatus,
    });
    setDetail((current) =>
      current
        ? {
            ...current,
            document: {
              ...current.document,
              status: nextStatus,
              sopPath: payload.sopPath ?? current.document.sopPath,
            },
            chunks: [],
          }
        : current,
    );
    selectQueueDocument(getQueueTabForStatus(nextStatus));
  };

  const recordApproval = async (role: "owner" | "admin") => {
    if (!selectedDocumentId) return;

    setPendingAction(`approve:${role}`);
    setErrorMessage("");
    setMessage("");

    try {
      const payload = await postApproval(role);

      setApprovalReason("");
      setMessage(`Aprovacao ${role} registrada.`);
      updateDocumentStatus(selectedDocumentId, {
        status: payload.status ?? detail?.document.status,
      });
      await loadDetail(selectedDocumentId);
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao registrar aprovacao."));
    } finally {
      setPendingAction("");
    }
  };

  const approveMissingAndPromote = async () => {
    if (!selectedDocumentId || !detail?.approvalGate) return;

    setPendingAction("approve-promote");
    setErrorMessage("");
    setMessage("");

    try {
      if (!detail.approvalGate.hasAnyApproval) {
        await postApproval("admin");
      }

      const payload = await postPromote();
      setApprovalReason("");
      applyPromotePayload(payload);
    } catch (error) {
      setErrorMessage(
        normalizeError(error, "Falha ao aprovar pendencias e publicar documento."),
      );
    } finally {
      setPendingAction("");
    }
  };

  const rejectDocument = async () => {
    if (!selectedDocumentId) return;

    const reason = rejectionReason.trim();
    if (!reason) {
      setErrorMessage("Informe o motivo para rejeitar o documento.");
      return;
    }

    setPendingAction("reject");
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(`/api/curation/${selectedDocumentId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const payload = (await response.json()) as {
        message?: string;
        status?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao rejeitar documento.");
      }

      setRejectionReason("");
      setMessage("Documento rejeitado.");
      const nextStatus = payload.status ?? "REJECTED";
      updateDocumentStatus(selectedDocumentId, { status: nextStatus });
      setQueueTab(getQueueTabForStatus(nextStatus));
      setSelectedDocumentId(selectedDocumentId);
      await loadDetail(selectedDocumentId);
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao rejeitar documento."));
    } finally {
      setPendingAction("");
    }
  };

  const discardDocument = async () => {
    if (!selectedDocumentId) return;

    setPendingAction("discard");
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(`/api/curation/${selectedDocumentId}/discard`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        message?: string;
        discarded?: boolean;
      };

      if (!response.ok || payload.discarded !== true) {
        throw new Error(payload.message ?? "Falha ao descartar documento.");
      }

      const nextRejectedDocumentId =
        rejectedRows.find((document) => document.id !== selectedDocumentId)?.id ?? "";
      removeDocumentFromState(selectedDocumentId);
      setDetail(null);
      setSelectedDocumentId(nextRejectedDocumentId);
      setIsDiscardModalOpen(false);
      setRejectionReason("");
    setMessage("Documento descartado do sistema e da area de revisao.");
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao descartar documento."));
    } finally {
      setPendingAction("");
    }
  };

  function sourceKey(s: ImprovementSource) {
    return `${s.documentId}:${s.chunkIndex}`;
  }

  function openImprovementModal() {
    setImprovementOpen(true);
    setImprovementPhase("config");
    setImprovementSuggestion("");
    setImprovementEdited("");
    setImprovementSources([]);
    setImprovementCandidates([]);
    setImprovementSelectedIds(new Set());
    setImprovementSourcesOpen(false);
  }

  async function searchImprovementCandidates() {
    if (!detail) return;
    setImprovementPhase("searching");

    try {
      const response = await fetch(
        `/api/curation/${detail.document.id}/improve/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: improvementLimit }),
        },
      );

      const payload = (await response.json()) as {
        sources?: ImprovementSource[];
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha na busca de referencias.");
      }

      const candidates = payload.sources ?? [];
      setImprovementCandidates(candidates);

      const autoSelected = new Set(
        candidates
          .filter((s) => s.score >= 0.75)
          .map((s) => sourceKey(s)),
      );
      setImprovementSelectedIds(autoSelected);
      setImprovementPhase("select");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Falha ao buscar referencias.",
      );
      setImprovementPhase("config");
    }
  }

  async function runImprovementFlow() {
    if (!detail) return;

    const selectedSources = improvementCandidates.filter((s) =>
      improvementSelectedIds.has(sourceKey(s)),
    );

    setImprovementPhase("running");
    setImprovementSuggestion("");
    setImprovementSources(selectedSources);

    let assembled = "";

    try {
      const response = await fetch(`/api/curation/${detail.document.id}/improve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: selectedSources }),
      });

      if (!response.body) {
        throw new Error("Servidor nao retornou stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);

          if (line) {
            const event = JSON.parse(line) as ImprovementEvent;
            if (event.type === "chunk") {
              assembled += event.data.text;
              setImprovementSuggestion(assembled);
            } else if (event.type === "error") {
              throw new Error(event.message);
            }
          }

          nl = buffer.indexOf("\n");
        }

        if (done) break;
      }

      setImprovementEdited(assembled);
      setImprovementPhase("review");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Falha ao gerar melhoria.",
      );
      setImprovementPhase("select");
    }
  }

  async function applyImprovementContent() {
    if (!detail || isApplyingImprovement) return;
    setIsApplyingImprovement(true);
    try {
      const response = await fetch(
        `/api/curation/${detail.document.id}/apply-improvement`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: improvementEdited }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "Falha ao aplicar melhoria.");
      }
      setImprovementOpen(false);
      setImprovementPhase("config");
      await loadDetail(detail.document.id);
      setMessage("Melhoria aplicada com sucesso. Documento retornou para revisao.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Falha ao aplicar melhoria.");
    } finally {
      setIsApplyingImprovement(false);
    }
  }

  async function saveDocumentContentDraft() {
    if (!detail || isSavingDocumentContent) return;

    const content = documentContentDraft.trim();
    if (!content) {
      setErrorMessage("Conteudo do documento nao pode ficar vazio.");
      return;
    }

    if (content === detail.document.normalizedMarkdown.trim()) {
      setIsEditingDocumentContent(false);
      setMessage("Nenhuma alteracao de conteudo para salvar.");
      return;
    }

    setIsSavingDocumentContent(true);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/curation/${detail.document.id}/apply-improvement`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        chunks?: number;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao salvar edicao do documento.");
      }

      setIsEditingDocumentContent(false);
      await loadDetail(detail.document.id);
      setMessage(
        `Documento atualizado. ${payload.chunks ?? 0} trecho(s) foram recriados na area de revisao.`,
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Falha ao salvar edicao do documento.",
      );
    } finally {
      setIsSavingDocumentContent(false);
    }
  }

  const promoteDocument = async () => {
    if (!selectedDocumentId) return;

    setPendingAction("promote");
    setErrorMessage("");
    setMessage("");

    try {
      const payload = await postPromote();
      applyPromotePayload(payload);
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao publicar documento."));
    } finally {
      setPendingAction("");
    }
  };

  const handleSectorChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const sector = event.target.value;
    router.push(`/admin/curation?sector=${sector}`);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <section className="premium-panel rounded-[2rem] p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Fila de Curadoria
            </p>
            <h3 className="mt-2 text-xl font-black text-[var(--foreground-strong)]">
              {selectedSector === "todos"
                ? "Todos os Setores"
                : (sectorLabelBySlug.get(selectedSector) ?? getSectorLabel(selectedSector))}
            </h3>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--accent)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
            disabled={!selectedDocumentId || isLoadingDetail}
            onClick={() => void loadDetail(selectedDocumentId)}
            title="Atualizar documento selecionado"
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {user.role === "admin" && (
          <div className="mt-6 space-y-2">
            <label
              className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]"
              htmlFor="sector-selector-card"
            >
              Agente/Banco de dados
            </label>
            <select
              className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--foreground-strong)] transition-shadow focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none"
              id="sector-selector-card"
              onChange={handleSectorChange}
              value={selectedSector}
            >
              <option value="todos">Todos os agentes</option>
              {availableSectorOptions.map((sector) => (
                <option key={sector.slug} value={sector.slug}>
                  {sector.displayName} / {sector.agentName}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Abas de filtro da fila */}
        <div className="mt-6 flex gap-1 rounded-xl bg-[var(--surface-muted)] p-1">
          <button
            className={`flex-1 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              queueTab === "queue"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => {
              selectQueueDocument("queue");
            }}
            type="button"
          >
            Em fila
            {queueRows.length > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] font-black text-[var(--accent)]">
                {queueRows.length}
              </span>
            )}
          </button>
          <button
            className={`flex-1 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              queueTab === "approved"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => {
              selectQueueDocument("approved");
            }}
            type="button"
          >
            Aprovados
            {approvedRows.length > 0 && (
              <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">
                {approvedRows.length}
              </span>
            )}
          </button>
          <button
            className={`flex-1 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              queueTab === "rejected"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => {
              selectQueueDocument("rejected");
            }}
            type="button"
          >
            Rejeitados
            {rejectedRows.length > 0 && (
              <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-600">
                {rejectedRows.length}
              </span>
            )}
          </button>
        </div>

        {visibleRows.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--foreground-soft)]">
            {queueTab === "rejected"
              ? "Nenhum documento rejeitado."
              : queueTab === "approved"
                ? "Nenhum documento aprovado ou promovido."
                : "Nenhum documento aguardando curadoria."}
          </p>
        ) : (
          <div className="mt-4 max-h-[760px] space-y-3 overflow-y-auto pr-2">
            {visibleRows.map((document) => {
              const isSelected = document.id === selectedDocumentId;
              const percent = readinessPercent(
                document.curationReadinessScore ?? document.sopReadinessScore,
              );

              return (
                <button
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                    isSelected
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border)] bg-white hover:border-[var(--border-strong)]"
                  }`}
                  key={document.id}
                  onClick={() => setSelectedDocumentId(document.id)}
                  type="button"
                >
                  <div className="flex items-start gap-3">
                    <FileText className="mt-1 h-5 w-5 shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-black text-[var(--foreground-strong)]">
                          {document.documentTitle}
                        </p>
                        <span className="shrink-0 text-[9px] font-black uppercase tracking-wider text-[var(--muted)]">
                          {getSectorLabel(document.sector)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--foreground-soft)]">
                        {document.fileName}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span
                          className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${statusClassName(document.status)}`}
                        >
                          {document.status}
                        </span>
                        <span className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--foreground-soft)]">
                          {percent !== null ? `${percent}%` : "sem score"}
                        </span>
                        {document.documentType ? (
                          <span className="rounded bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--foreground-soft)]">
                            {DOCUMENT_TYPE_LABELS[document.documentType]}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-6">
        {selectedDocument ? (
          <div className="premium-panel rounded-[2rem] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Documento selecionado
                </p>
                <h3 className="mt-2 text-2xl font-black text-[var(--foreground-strong)]">
                  {selectedDocument.documentTitle}
                </h3>
                <p className="mt-2 text-sm text-[var(--foreground-soft)]">
                  {selectedDocument.fileName} | upload{" "}
                  {new Date(selectedDocument.uploadedAt).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 lg:items-end">
                {detail?.document.status === "REJECTED" ? (
                  <button
                    className="inline-flex items-center gap-2 rounded-2xl border border-red-300 bg-red-600 px-4 py-3 text-sm font-bold text-white shadow-[0_12px_30px_-14px_rgba(220,38,38,0.65)] transition-colors hover:bg-red-700 disabled:opacity-50"
                    disabled={pendingAction === "discard"}
                    onClick={() => setIsDiscardModalOpen(true)}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                    {pendingAction === "discard"
                      ? "Descartando..."
                      : "Descartar definitivamente"}
                  </button>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded px-3 py-2 text-xs font-bold uppercase tracking-wider ${statusClassName(detail?.document.status ?? selectedDocument.status)}`}
                  >
                    {detail?.document.status ?? selectedDocument.status}
                  </span>
                  <span className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--foreground-soft)]">
                    Prontidao{" "}
                    {readiness ??
                      readinessPercent(
                        selectedDocument.curationReadinessScore ??
                          selectedDocument.sopReadinessScore,
                      ) ??
                      0}
                    %
                  </span>
                  {(detail?.document.documentType ?? selectedDocument.documentType) ? (
                    <span className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--foreground-soft)]">
                      {
                        DOCUMENT_TYPE_LABELS[
                          (detail?.document.documentType ??
                            selectedDocument.documentType) as DocumentType
                        ]
                      }
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {detail?.document.status === "REJECTED" ? (
              <div className="mt-5 rounded-2xl border border-red-300 bg-gradient-to-r from-red-50 to-white px-4 py-3 text-sm text-red-800">
                Documento rejeitado. Use o descarte definitivo para remover o registro do sistema e limpar a area de revisao.
              </div>
            ) : null}

            {errorMessage ? (
              <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
                {errorMessage}
              </div>
            ) : null}
            {message ? (
              <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {message}
              </div>
            ) : null}
          </div>
        ) : null}

        {isLoadingDetail ? (
          <div className="premium-panel rounded-[2rem] p-6 text-sm text-[var(--foreground-soft)]">
            Carregando documento de curadoria...
          </div>
        ) : null}

        {detail ? (
          <>
            <div className="premium-panel rounded-[2rem] p-6">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    Trechos em revisao
                  </p>
                  <p className="mt-2 text-xl font-black text-[var(--foreground-strong)]">
                    {detail.chunks.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    Perguntas
                  </p>
                  <p className="mt-2 text-xl font-black text-[var(--foreground-strong)]">
                    {answeredQuestionCount}/{templateQuestions.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    Dono
                  </p>
                  <p className="mt-2 truncate text-sm font-black text-[var(--foreground-strong)]">
                    {detail.document.owner ?? "-"}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    Vigencia
                  </p>
                  <p className="mt-2 text-sm font-black text-[var(--foreground-strong)]">
                    {detail.document.effectiveFrom
                      ? new Date(detail.document.effectiveFrom).toLocaleDateString(
                          "pt-BR",
                        )
                      : "-"}
                  </p>
                </div>
              </div>
            </div>

            <div className="premium-panel rounded-[2rem] p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Correlacao setorial
                  </p>
                  <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                    Conteudo ja publicado
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                    {detail.correlationGate.status === "NOT_RUN"
                      ? "Aguardando comparacao com os trechos ja publicados pelo mesmo agente."
                      : detail.correlationGate.summary ??
                        "Correlacao executada para este documento."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-3 py-2 text-xs font-bold uppercase tracking-wider ${
                      detail.correlationGate.canApprove
                        ? "bg-emerald-400/15 text-emerald-700"
                        : "bg-amber-400/20 text-amber-800"
                    }`}
                  >
                    {detail.correlationGate.status}
                  </span>
                  <button
                    className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                    disabled={
                      pendingAction === "correlate" ||
                      detail.document.status === "PROMOTED" ||
                      detail.document.status === "REJECTED"
                    }
                    onClick={() => void runCorrelation(detail.document.id)}
                    type="button"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {pendingAction === "correlate"
                      ? "Verificando..."
                      : "Verificar correlacao"}
                  </button>
                </div>
              </div>

              {detail.correlationGate.blockingFindings.length > 0 ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Aprovacao bloqueada ate resolver{" "}
                  {detail.correlationGate.blockingFindings.length} achado(s)
                  high/critical.
                </div>
              ) : null}

              {detail.correlationGate.findings.length === 0 ? (
                <p className="mt-6 rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--foreground-soft)]">
                  Nenhum achado registrado na ultima correlacao.
                </p>
              ) : (
                <div className="mt-6 space-y-4">
                  {detail.correlationGate.findings.map((finding) => {
                    const isOpen = finding.status === "open";
                    const pendingPrefix = `correlation:${finding.id}:`;

                    return (
                      <article
                        className="rounded-2xl border border-[var(--border)] bg-white p-4"
                        key={finding.id}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${severityClassName(finding.severity)}`}
                              >
                                {finding.severity}
                              </span>
                              <span className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--foreground-soft)]">
                                {finding.type}
                              </span>
                              <span className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--foreground-soft)]">
                                {finding.status}
                              </span>
                            </div>
                            <h4 className="mt-3 text-sm font-black text-[var(--foreground-strong)]">
                              {finding.issue}
                            </h4>
                            <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                              {finding.question}
                            </p>
                            {finding.recommendation ? (
                              <p className="mt-2 text-xs leading-5 text-[var(--foreground-soft)]">
                                Recomendacao: {finding.recommendation}
                              </p>
                            ) : null}
                          </div>
                          {finding.severity === "high" ||
                          finding.severity === "critical" ? (
                            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
                          ) : null}
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                              Trecho em revisao
                            </p>
                            <p className="mt-2 text-xs font-bold text-[var(--foreground-strong)]">
                              {finding.stagedHeadingPathText} | trecho{" "}
                              {finding.stagedChunkIndex + 1}
                            </p>
                            <p className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--foreground-soft)]">
                              {finding.stagedContentPreview}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                              Trecho publicado relacionado
                            </p>
                            <p className="mt-2 text-xs font-bold text-[var(--foreground-strong)]">
                              {finding.relatedChunk.documentTitle} | score{" "}
                              {Math.round(finding.relatedChunk.score * 100)}%
                            </p>
                            <p className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--foreground-soft)]">
                              {finding.relatedChunk.contentPreview}
                            </p>
                          </div>
                        </div>

                        {finding.resolution ? (
                          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-800">
                            <strong>Resolucao:</strong>{" "}
                            {finding.resolution.answer}
                            {finding.resolution.revisedChunkPreview ? (
                              <p className="mt-2 text-xs leading-5">
                                Ajuste aplicado:{" "}
                                {finding.resolution.revisedChunkPreview}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {isOpen && canEditAnswers ? (
                          <div className="mt-4">
                            <textarea
                              className="min-h-24 w-full resize-y rounded-2xl border border-[var(--border)] bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                              onChange={(event) =>
                                setCorrelationAnswers((current) => ({
                                  ...current,
                                  [finding.id]: event.target.value,
                                }))
                              }
                              placeholder="Valide qual informacao prevalece e como este conteudo deve ser compatibilizado."
                              value={correlationAnswers[finding.id] ?? ""}
                            />
                            <div className="mt-3 flex flex-wrap gap-3">
                              <button
                                className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
                                disabled={pendingAction.startsWith(pendingPrefix)}
                                onClick={() =>
                                  void resolveCorrelation(
                                    finding.id,
                                    "revised_staging",
                                  )
                                }
                                type="button"
                              >
                                Aplicar ajuste ao documento em revisao
                              </button>
                              <button
                                className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                                disabled={pendingAction.startsWith(pendingPrefix)}
                                onClick={() =>
                                  void resolveCorrelation(finding.id, "validated")
                                }
                                type="button"
                              >
                                Registrar validacao
                              </button>
                              <button
                                className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                                disabled={pendingAction.startsWith(pendingPrefix)}
                                onClick={() =>
                                  void resolveCorrelation(finding.id, "dismissed")
                                }
                                type="button"
                              >
                                Dispensar achado
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="premium-panel rounded-[2rem] p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Trechos em revisao
                  </p>
                  <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                    Conteudo que ainda nao foi publicado no chat
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  {!isPromoted ? (
                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--accent)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)] hover:text-white"
                      onClick={openImprovementModal}
                      type="button"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Melhoria Assistida
                    </button>
                  ) : null}
                  <span className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--foreground-soft)]">
                    ID origem {detail.document.sourceDocumentId.slice(0, 12)}
                  </span>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2 rounded-2xl bg-[var(--surface-muted)] p-1">
                <button
                  className={`rounded-2xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                    stagingViewTab === "full"
                      ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                      : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
                  }`}
                  onClick={() => setStagingViewTab("full")}
                  type="button"
                >
                  Conteudo completo
                </button>
                <button
                  className={`rounded-2xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                    stagingViewTab === "chunks"
                      ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                      : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
                  }`}
                  onClick={() => setStagingViewTab("chunks")}
                  type="button"
                >
                  Trechos
                </button>
              </div>

              {!stagingChunks || stagingChunks.length === 0 ? (
                <p className="mt-6 rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--foreground-soft)]">
                  Nenhum trecho encontrado na area de revisao. Se o documento ja foi
                  publicado, os trechos intermediarios ja foram removidos.
                </p>
              ) : stagingViewTab === "full" ? (
                <div className="mt-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-[var(--accent-soft)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                        documento normalizado
                      </span>
                      <span className="rounded bg-[var(--surface-muted)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--foreground-soft)]">
                        {stagingChunks.length} trecho{stagingChunks.length > 1 ? "s" : ""}
                      </span>
                    </div>

                    {!isPromoted ? (
                      isEditingDocumentContent ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-2 text-xs font-bold text-[var(--foreground-strong)] transition-colors hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                            disabled={isSavingDocumentContent}
                            onClick={() => {
                              setDocumentContentDraft(detail.document.normalizedMarkdown);
                              setIsEditingDocumentContent(false);
                            }}
                            type="button"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Cancelar
                          </button>
                          <button
                            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
                            disabled={
                              isSavingDocumentContent ||
                              !documentContentDraft.trim() ||
                              documentContentDraft.trim() ===
                                detail.document.normalizedMarkdown.trim()
                            }
                            onClick={() => void saveDocumentContentDraft()}
                            type="button"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {isSavingDocumentContent ? "Salvando..." : "Salvar edicao"}
                          </button>
                        </div>
                      ) : (
                        <button
                          className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-2 text-xs font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          onClick={() => {
                            setDocumentContentDraft(detail.document.normalizedMarkdown);
                            setIsEditingDocumentContent(true);
                            setErrorMessage("");
                            setMessage("");
                          }}
                          type="button"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar documento
                        </button>
                      )
                    ) : null}
                  </div>
                  {isEditingDocumentContent ? (
                    <textarea
                      className="min-h-[680px] w-full resize-y whitespace-pre-wrap rounded-[1.5rem] border border-[var(--accent)] bg-white p-5 font-mono text-xs leading-6 text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
                      disabled={isSavingDocumentContent}
                      onChange={(event) => setDocumentContentDraft(event.target.value)}
                      spellCheck={false}
                      value={documentContentDraft}
                    />
                  ) : (
                    <pre className="max-h-[680px] overflow-auto whitespace-pre-wrap break-words rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface-soft)] p-5 font-mono text-xs leading-6 text-[var(--foreground)]">
                      {detail.document.normalizedMarkdown || consolidatedStagingContent}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {stagingChunks.map((chunk) => (
                    <article
                      className="rounded-2xl border border-[var(--border)] bg-white p-4"
                      key={chunk.id}
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
                            Trecho {chunk.chunkIndex + 1}
                          </p>
                          <h4 className="mt-1 text-sm font-black text-[var(--foreground-strong)]">
                            {chunk.headingPathText}
                          </h4>
                        </div>
                        {chunk.contentHash ? (
                          <p className="max-w-full truncate font-mono text-[10px] text-[var(--muted)] md:max-w-[320px]">
                            {chunk.contentHash}
                          </p>
                        ) : null}
                      </div>
                      <pre className="mt-4 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-[var(--surface-muted)] p-4 font-mono text-xs leading-6 text-[var(--foreground)]">
                        {chunk.content}
                      </pre>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="premium-panel rounded-[2rem] p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Validacao SOP
              </p>
              <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                Perguntas opcionais de curadoria
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                {canEditAnswers
                  ? "As perguntas ajudam a enriquecer o artefato curado, mas nao bloqueiam a aprovacao final. Itens respondidos ficam recolhidos e podem ser editados antes de uma nova aprovacao."
                  : "Documento publicado: respostas ficam somente para consulta nesta revisao."}
              </p>

              {defaultAnswerCount > 0 ? (
                <div className="mt-4 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent)]">
                  {defaultAnswerCount} resposta{defaultAnswerCount > 1 ? "s" : ""} preenchida
                  {defaultAnswerCount > 1 ? "s" : ""} automaticamente. Revise antes de aprovar.
                </div>
              ) : null}

              <div className="mt-6 space-y-4">
                {templateQuestions.map((question) => {
                  const response = question.response?.trim() ?? "";
                  const isServerDefault =
                    question.isDefault === true && response.length > 0;
                  const isAnsweredByCurator =
                    question.isDefault !== true && response.length > 0;
                  const isAnswered = isServerDefault || isAnsweredByCurator;
                  const isEditing = editingQuestionIds[question.id] === true;
                  const isOpen = !isAnswered || isEditing;
                  const currentValue = answers[question.id] ?? "";
                  const isPreFilled = !isAnswered && currentValue.length > 0;

                  return (
                    <div
                      className={`rounded-2xl border p-4 ${
                        isAnsweredByCurator
                          ? "border-emerald-200 bg-emerald-50/55"
                          : isServerDefault || isPreFilled
                            ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                            : "border-amber-200 bg-amber-50/60"
                      }`}
                      key={question.id}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[var(--foreground-strong)]">
                            {question.prompt}
                          </p>
                          <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                            {isAnsweredByCurator
                              ? "Resposta registrada na curadoria."
                              : isServerDefault || isPreFilled
                                ? "Valor sugerido automaticamente. Confirme ou ajuste antes de prosseguir."
                                : "Resposta opcional para enriquecer a curadoria."}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <span
                            className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                              isAnsweredByCurator
                                ? "bg-emerald-400/15 text-emerald-700"
                                : isServerDefault || isPreFilled
                                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                                  : "bg-amber-400/15 text-amber-700"
                            }`}
                          >
                            {isAnswered ? "respondida" : isPreFilled ? "sugestão" : "pendente"}
                          </span>
                          {isServerDefault ? (
                            <span className="rounded bg-[var(--accent)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                              Sugestao automatica
                            </span>
                          ) : null}
                          {isAnswered && canEditAnswers ? (
                            <button
                              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                              disabled={pendingAction === `answer:${question.id}`}
                              onClick={() => {
                                setEditingQuestionIds((current) => ({
                                  ...current,
                                  [question.id]: !isEditing,
                                }));
                                setAnswers((current) => ({
                                  ...current,
                                  [question.id]: question.response ?? "",
                                }));
                              }}
                              type="button"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              {isEditing ? "Cancelar" : "Editar"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {!isOpen || !canEditAnswers ? (
                        <p className="mt-4 max-h-24 overflow-hidden whitespace-pre-wrap rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm leading-6 text-[var(--foreground-soft)]">
                          {question.id === "metadata_sensitivity"
                            ? (SENSITIVITY_LABELS[response] ?? response) || "Documento publicado sem resposta editavel."
                            : response || "Documento publicado sem resposta editavel."}
                        </p>
                      ) : (
                        <>
                          <label
                            className="sr-only"
                            htmlFor={`question-${question.id}`}
                          >
                            {question.prompt}
                          </label>

                          {question.id === "metadata_sensitivity" ? (
                            <select
                              className="mt-3 w-full rounded-2xl border border-[var(--border)] bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                              id={`question-${question.id}`}
                              name={`question-${question.id}`}
                              onChange={(event) =>
                                setAnswers((current) => ({
                                  ...current,
                                  [question.id]: event.target.value,
                                }))
                              }
                              value={answers[question.id] ?? "internal"}
                            >
                              {SENSITIVITY_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : question.id === "metadata_effective_from" ? (
                            <input
                              className="mt-3 w-full rounded-2xl border border-[var(--border)] bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                              id={`question-${question.id}`}
                              name={`question-${question.id}`}
                              onChange={(event) =>
                                setAnswers((current) => ({
                                  ...current,
                                  [question.id]: event.target.value,
                                }))
                              }
                              type="date"
                              value={answers[question.id] ?? ""}
                            />
                          ) : question.id === "metadata_owner" ? (
                            <input
                              className="mt-3 w-full rounded-2xl border border-[var(--border)] bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                              id={`question-${question.id}`}
                              name={`question-${question.id}`}
                              onChange={(event) =>
                                setAnswers((current) => ({
                                  ...current,
                                  [question.id]: event.target.value,
                                }))
                              }
                              placeholder="email@empresa.com"
                              type="email"
                              value={answers[question.id] ?? ""}
                            />
                          ) : question.id === "metadata_title" ? (
                            <input
                              className="mt-3 w-full rounded-2xl border border-[var(--border)] bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                              id={`question-${question.id}`}
                              name={`question-${question.id}`}
                              onChange={(event) =>
                                setAnswers((current) => ({
                                  ...current,
                                  [question.id]: event.target.value,
                                }))
                              }
                              placeholder="Titulo canônico do SOP"
                              type="text"
                              value={answers[question.id] ?? ""}
                            />
                          ) : (
                            <textarea
                              className="mt-3 min-h-24 w-full resize-y rounded-2xl border border-[var(--border)] bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                              id={`question-${question.id}`}
                              name={`question-${question.id}`}
                              onChange={(event) =>
                                setAnswers((current) => ({
                                  ...current,
                                  [question.id]: event.target.value,
                                }))
                              }
                              value={answers[question.id] ?? ""}
                            />
                          )}

                          <button
                            className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
                            disabled={pendingAction === `answer:${question.id}`}
                            onClick={() => void submitAnswer(question.id)}
                            type="button"
                          >
                            <Send className="h-4 w-4" />
                            {pendingAction === `answer:${question.id}`
                              ? "Validando..."
                              : isAnswered
                                ? "Salvar ajuste"
                                : "Confirmar"}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {processGapQuestions.length > 0 ? (
                <div className="mt-8 border-t border-[var(--border)] pt-6">
                  <div className="mb-3 flex items-center gap-3">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Mapeamento de processos
                    </p>
                    <span className="rounded bg-cyan-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-700">
                      Processo - nao afeta a prontidao
                    </span>
                  </div>
                  <p className="mb-4 text-sm text-[var(--foreground-soft)]">
                    Perguntas enviadas a partir do mapa operacional para completar o desenho da automacao.
                  </p>

                  <div className="space-y-4">
                    {processGapQuestions.map((question) => {
                      const response = question.response?.trim() ?? "";
                      const isAnswered = response.length > 0;
                      const isEditing = editingQuestionIds[question.id] === true;
                      const isOpen = !isAnswered || isEditing;

                      return (
                        <div
                          className={`rounded-2xl border p-4 ${
                            isAnswered
                              ? "border-cyan-200 bg-cyan-50/60"
                              : "border-cyan-200/80 bg-cyan-50/35"
                          }`}
                          key={question.id}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-[var(--foreground-strong)]">
                                {question.prompt}
                              </p>
                              <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                                {isAnswered
                                  ? "Resposta registrada para fechar a pergunta do processo."
                                  : "Pergunta opcional enviada pelo mapa de processos."}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <span
                                className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                                  isAnswered
                                    ? "bg-cyan-200 text-cyan-800"
                                    : "bg-cyan-100 text-cyan-700"
                                }`}
                              >
                                {isAnswered ? "pergunta respondida" : "pergunta aberta"}
                              </span>
                              {isAnswered && canEditAnswers ? (
                                <button
                                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold text-[var(--foreground-strong)] transition-colors hover:border-cyan-400 disabled:opacity-50"
                                  disabled={pendingAction === `answer:${question.id}`}
                                  onClick={() => {
                                    setEditingQuestionIds((current) => ({
                                      ...current,
                                      [question.id]: !isEditing,
                                    }));
                                    setAnswers((current) => ({
                                      ...current,
                                      [question.id]: question.response ?? "",
                                    }));
                                  }}
                                  type="button"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  {isEditing ? "Cancelar" : "Editar"}
                                </button>
                              ) : null}
                            </div>
                          </div>

                          {!isOpen || !canEditAnswers ? (
                            <p className="mt-4 max-h-24 overflow-hidden whitespace-pre-wrap rounded-2xl border border-cyan-200 bg-white px-4 py-3 text-sm leading-6 text-[var(--foreground-soft)]">
                              {response || "Sem resposta registrada."}
                            </p>
                          ) : (
                            <>
                              <label
                                className="sr-only"
                                htmlFor={`question-${question.id}`}
                              >
                                {question.prompt}
                              </label>
                              <textarea
                                className="mt-3 min-h-24 w-full resize-y rounded-2xl border border-cyan-200 bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-cyan-400"
                                id={`question-${question.id}`}
                                name={`question-${question.id}`}
                                onChange={(event) =>
                                  setAnswers((current) => ({
                                    ...current,
                                    [question.id]: event.target.value,
                                  }))
                                }
                                value={answers[question.id] ?? ""}
                              />
                              <button
                                className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-cyan-700 disabled:opacity-50"
                                disabled={pendingAction === `answer:${question.id}`}
                                onClick={() => void submitAnswer(question.id)}
                                type="button"
                              >
                                <Send className="h-4 w-4" />
                                {pendingAction === `answer:${question.id}`
                                  ? "Validando..."
                                  : isAnswered
                                    ? "Salvar ajuste"
                                    : "Salvar resposta"}
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {inferredQuestions.length > 0 ? (
                <div className="mt-8 border-t border-[var(--border)] pt-6">
                  <div className="mb-3 flex items-center gap-3">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Analise do conteudo
                    </p>
                    <span className="rounded bg-violet-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                      IA - nao afeta a prontidao
                    </span>
                  </div>
                  <p className="mb-4 text-sm text-[var(--foreground-soft)]">
                    Perguntas identificadas a partir do conteudo. Sao opcionais e nao afetam a aprovacao.
                  </p>

                  <div className="space-y-4">
                    {inferredQuestions.map((question) => {
                      const response = question.response?.trim() ?? "";
                      const isAnswered = response.length > 0;
                      const isEditing = editingQuestionIds[question.id] === true;
                      const isOpen = !isAnswered || isEditing;

                      return (
                        <div
                          className={`rounded-2xl border p-4 ${
                            isAnswered
                              ? "border-violet-200 bg-violet-50/60"
                              : "border-violet-200/80 bg-violet-50/35"
                          }`}
                          key={question.id}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-[var(--foreground-strong)]">
                                {question.prompt}
                              </p>
                              <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                                {isAnswered
                                  ? "Resposta opcional registrada na curadoria."
                                  : "Pergunta sugerida pela analise do conteudo."}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <span
                                className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                                  isAnswered
                                    ? "bg-violet-200 text-violet-800"
                                    : "bg-violet-100 text-violet-700"
                                }`}
                              >
                                {isAnswered ? "opcional respondida" : "opcional"}
                              </span>
                              {isAnswered && canEditAnswers ? (
                                <button
                                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold text-[var(--foreground-strong)] transition-colors hover:border-violet-400 disabled:opacity-50"
                                  disabled={pendingAction === `answer:${question.id}`}
                                  onClick={() => {
                                    setEditingQuestionIds((current) => ({
                                      ...current,
                                      [question.id]: !isEditing,
                                    }));
                                    setAnswers((current) => ({
                                      ...current,
                                      [question.id]: question.response ?? "",
                                    }));
                                  }}
                                  type="button"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  {isEditing ? "Cancelar" : "Editar"}
                                </button>
                              ) : null}
                            </div>
                          </div>

                          {!isOpen || !canEditAnswers ? (
                            <p className="mt-4 max-h-24 overflow-hidden whitespace-pre-wrap rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm leading-6 text-[var(--foreground-soft)]">
                              {response || "Sem resposta registrada."}
                            </p>
                          ) : (
                            <>
                              <label
                                className="sr-only"
                                htmlFor={`question-${question.id}`}
                              >
                                {question.prompt}
                              </label>
                              <textarea
                                className="mt-3 min-h-24 w-full resize-y rounded-2xl border border-violet-200 bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-violet-400"
                                id={`question-${question.id}`}
                                name={`question-${question.id}`}
                                onChange={(event) =>
                                  setAnswers((current) => ({
                                    ...current,
                                    [question.id]: event.target.value,
                                  }))
                                }
                                value={answers[question.id] ?? ""}
                              />
                              <button
                                className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                                disabled={pendingAction === `answer:${question.id}`}
                                onClick={() => void submitAnswer(question.id)}
                                type="button"
                              >
                                <Send className="h-4 w-4" />
                                {pendingAction === `answer:${question.id}`
                                  ? "Validando..."
                                  : isAnswered
                                    ? "Salvar ajuste"
                                    : "Salvar resposta opcional"}
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="premium-panel rounded-[2rem] p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Aprovacao e publicacao
              </p>
              <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                Etapa final antes de entrar no chat
              </h3>

              <div className="mt-5 space-y-2">
                {detail.approvals.length === 0 ? (
                  <p className="text-sm text-[var(--foreground-soft)]">
                    Nenhuma aprovacao registrada.
                  </p>
                ) : (
                  detail.approvals.map((approval) => (
                    <div
                      className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--foreground-soft)]"
                      key={approval.id}
                    >
                      <strong className="text-[var(--foreground-strong)]">
                        {approval.approverRole}
                      </strong>{" "}
                      {approval.decision} em{" "}
                      {new Date(approval.createdAt).toLocaleString("pt-BR")}
                      {approval.reason ? ` | ${approval.reason}` : ""}
                    </div>
                  ))
                )}
              </div>

              {approvalGate ? (
                <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    Requisitos para publicar
                  </p>
                  <p className="mt-2 text-sm text-[var(--foreground-soft)]">
                    Basta uma aprovacao do dono ou de um admin para liberar a publicacao.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
                      <p className="text-xs font-bold text-[var(--foreground-strong)]">
                        Aprovacao do dono
                      </p>
                      <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                        {approvalGate.hasOwnerApproval ? "Registrada" : "Opcional"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
                      <p className="text-xs font-bold text-[var(--foreground-strong)]">
                        Aprovacao admin
                      </p>
                      <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                        {approvalGate.hasAdminApproval ? "Registrada" : "Opcional"}
                      </p>
                    </div>
                  </div>
                  {promoteBlocker ? (
                    <p
                      className={`mt-3 text-sm ${
                        isPromoted ? "text-emerald-700" : "text-[var(--warn)]"
                      }`}
                    >
                      {promoteBlocker}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-emerald-700">
                      Documento aprovado e liberado para publicacao.
                    </p>
                  )}
                </div>
              ) : null}

              <textarea
                className="mt-5 min-h-20 w-full resize-y rounded-2xl border border-[var(--border)] bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                id="approval-reason"
                name="approval-reason"
                onChange={(event) => setApprovalReason(event.target.value)}
                placeholder="Observacao opcional para aprovacao"
                value={approvalReason}
              />

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                  disabled={
                    !canApprove ||
                    approvalGate?.hasOwnerApproval === true ||
                    pendingAction === "approve:owner" ||
                    pendingAction === "approve-promote"
                  }
                  onClick={() => void recordApproval("owner")}
                  title={
                    approvalGate?.hasOwnerApproval
                      ? "Aprovacao do dono ja registrada"
                      : undefined
                  }
                  type="button"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  Aprovar como dono
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                  disabled={
                    !canApprove ||
                    approvalGate?.hasAdminApproval === true ||
                    pendingAction === "approve:admin" ||
                    pendingAction === "approve-promote"
                  }
                  onClick={() => void recordApproval("admin")}
                  title={
                    approvalGate?.hasAdminApproval
                      ? "Aprovacao admin ja registrada"
                      : undefined
                  }
                  type="button"
                >
                  <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
                  Aprovar como admin
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-2xl border border-[var(--accent)] bg-white px-4 py-3 text-sm font-bold text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
                  disabled={
                    !canApproveMissingAndPromote ||
                    pendingAction === "approve-promote"
                  }
                  onClick={() => void approveMissingAndPromote()}
                  type="button"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {pendingAction === "approve-promote"
                    ? "Aprovando e publicando..."
                    : "Aprovar pendencias e publicar"}
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
                  disabled={
                    !canPromote ||
                    pendingAction === "promote" ||
                    pendingAction === "approve-promote"
                  }
                  onClick={() => void promoteDocument()}
                  title={promoteBlocker || undefined}
                  type="button"
                >
                  <UploadCloud className="h-4 w-4" />
                  {pendingAction === "promote" ? "Publicando..." : "Publicar"}
                </button>
              </div>

              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4">
                <label
                  className="text-sm font-bold text-[var(--foreground-strong)]"
                  htmlFor="rejection-reason"
                >
                  Motivo de rejeicao
                </label>
                <textarea
                  className="mt-3 min-h-20 w-full resize-y rounded-2xl border border-red-200 bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-red-400"
                  id="rejection-reason"
                  name="rejection-reason"
                  onChange={(event) => setRejectionReason(event.target.value)}
                  value={rejectionReason}
                />
                <button
                  className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-[var(--danger)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                  disabled={
                    detail.document.status === "REJECTED" || pendingAction === "reject"
                  }
                  onClick={() => void rejectDocument()}
                  type="button"
                >
                  <XCircle className="h-4 w-4" />
                  {pendingAction === "reject" ? "Rejeitando..." : "Rejeitar"}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>

      {improvementOpen && detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div
            className="flex w-full max-w-[1400px] flex-col rounded-[2rem] bg-white shadow-2xl"
            style={{ height: "92vh" }}
          >
            {/* Modal header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-8 py-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
                  Melhoria Assistida Multi-Setor
                </p>
                <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                  {detail.document.documentTitle}
                </h3>
                <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                  Setor: {detail.document.sector} | Status: {detail.document.status}
                </p>
              </div>
              <button
                className="mt-1 shrink-0 rounded-full p-2 text-[var(--muted)] transition-colors hover:bg-slate-100 hover:text-[var(--foreground)]"
                onClick={() => setImprovementOpen(false)}
                title="Fechar"
                type="button"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Phase: config */}
            {improvementPhase === "config" ? (
              <div className="flex flex-1 items-center justify-center overflow-auto px-8 py-10">
                <div className="w-full max-w-xl space-y-6">
                  <div className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface-soft)] p-6">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Configuracao da busca
                    </p>
                    <h4 className="mt-2 text-base font-black text-[var(--foreground-strong)]">
                      Maximo de referencias por setor
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-[var(--foreground-soft)]">
                      O sistema buscara ate <strong>{improvementLimit}</strong> trecho
                      {improvementLimit > 1 ? "s" : ""} por banco de producao (similaridade{" "}
                      <strong>&ge; 60%</strong>), totalizando ate{" "}
                      <strong>{improvementLimit * availableSectorOptions.length}</strong> candidatos. Voce
                      escolhe quais incluir antes de gerar a sugestao.
                    </p>
                    <div className="mt-4 flex items-center gap-4">
                      <input
                        className="h-2 w-full accent-[var(--accent)]"
                        max={10}
                        min={1}
                        onChange={(e) => setImprovementLimit(Number(e.target.value))}
                        step={1}
                        type="range"
                        value={improvementLimit}
                      />
                      <span className="w-8 shrink-0 text-center text-sm font-black text-[var(--foreground-strong)]">
                        {improvementLimit}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface-soft)] p-6">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Setores consultados
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {availableSectorOptions.map((sector) => (
                        <span
                          key={sector.slug}
                          className="rounded-xl bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--accent)]"
                        >
                          {sector.displayName}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[var(--foreground-soft)]">
                      Todos os bancos de producao sao consultados independente do setor do documento.
                    </p>
                  </div>

                  <button
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] py-4 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)]"
                    onClick={() => void searchImprovementCandidates()}
                    type="button"
                  >
                    <Sparkles className="h-4 w-4" />
                    Buscar Referencias nos Bancos de Producao
                  </button>
                </div>
              </div>
            ) : null}

            {/* Phase: searching */}
            {improvementPhase === "searching" ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center gap-5 text-center">
                  <div className="relative h-14 w-14">
                    <div className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)]/20" />
                    <div className="absolute inset-2 animate-pulse rounded-full bg-[var(--accent)]/40" />
                    <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-[var(--accent)]" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[var(--accent)]">
                      Buscando referencias...
                    </p>
                    <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                      Consultando todos os bancos de producao. Isso pode levar alguns instantes.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Phase: select */}
            {improvementPhase === "select" ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-muted)] px-8 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-[var(--foreground-strong)]">
                        {improvementCandidates.length} referencia{improvementCandidates.length !== 1 ? "s" : ""} encontrada{improvementCandidates.length !== 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-[var(--foreground-soft)]">
                        Trechos com similaridade &ge; 60% nos bancos de producao.
                        Referencias &ge; 75% foram pre-selecionadas.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-[var(--accent)]">
                        {improvementSelectedIds.size} selecionada{improvementSelectedIds.size !== 1 ? "s" : ""}
                      </span>
                      <button
                        className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        onClick={() =>
                          setImprovementSelectedIds(
                            new Set(improvementCandidates.map((s) => sourceKey(s))),
                          )
                        }
                        type="button"
                      >
                        Selecionar todas
                      </button>
                      <button
                        className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--foreground-soft)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)]"
                        onClick={() => setImprovementSelectedIds(new Set())}
                        type="button"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>
                </div>

                {improvementCandidates.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-center">
                    <div>
                      <p className="text-sm font-bold text-[var(--foreground-strong)]">
                        Nenhuma referencia encontrada
                      </p>
                      <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                        Nenhum trecho nos bancos de producao atingiu similaridade &ge; 60% com este documento.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 overflow-auto px-8 py-5 space-y-6">
                    {candidateSectorSlugs.map((sector) => {
                      const sectorCandidates = improvementCandidates.filter(
                        (c) => c.sector === sector,
                      );
                      const allSectorSelected = sectorCandidates.every((c) =>
                        improvementSelectedIds.has(sourceKey(c)),
                      );

                      return (
                        <div key={sector}>
                          <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="rounded-xl bg-[var(--accent-soft)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
                                {sectorLabelBySlug.get(sector) ?? getSectorLabel(sector)}
                              </span>
                              <span className="text-xs text-[var(--foreground-soft)]">
                                {sectorCandidates.length} referencia{sectorCandidates.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <button
                              className="text-xs font-bold text-[var(--accent)] hover:underline"
                              onClick={() => {
                                const keys = sectorCandidates.map((c) => sourceKey(c));
                                setImprovementSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (allSectorSelected) {
                                    keys.forEach((k) => next.delete(k));
                                  } else {
                                    keys.forEach((k) => next.add(k));
                                  }
                                  return next;
                                });
                              }}
                              type="button"
                            >
                              {allSectorSelected ? "Desmarcar todas" : "Selecionar todas"}
                            </button>
                          </div>

                          <div className="grid gap-3 lg:grid-cols-2">
                            {sectorCandidates.map((candidate) => {
                              const key = sourceKey(candidate);
                              const isSelected = improvementSelectedIds.has(key);
                              const isHighConf = candidate.score >= 0.75;

                              return (
                                <div
                                  key={key}
                                  className={`flex flex-col rounded-2xl border transition-colors ${
                                    isSelected
                                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                                      : "border-[var(--border)] bg-white"
                                  }`}
                                >
                                  {/* Card header — clickable checkbox area */}
                                  <label className="flex cursor-pointer items-start gap-3 p-4">
                                    <input
                                      checked={isSelected}
                                      className="mt-0.5 shrink-0 accent-[var(--accent)]"
                                      onChange={() => {
                                        setImprovementSelectedIds((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(key)) next.delete(key);
                                          else next.add(key);
                                          return next;
                                        });
                                      }}
                                      type="checkbox"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span
                                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                            isHighConf
                                              ? "bg-emerald-100 text-emerald-700"
                                              : "bg-amber-100 text-amber-700"
                                          }`}
                                        >
                                          {Math.round(candidate.score * 100)}% sim.
                                        </span>
                                        {isHighConf ? (
                                          <span className="text-[10px] font-bold text-emerald-600">
                                            alta similaridade
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="mt-1.5 text-sm font-black text-[var(--foreground-strong)]">
                                        {candidate.documentTitle}
                                      </p>
                                      <p className="text-xs text-[var(--foreground-soft)]">
                                        {candidate.headingPathText}
                                      </p>
                                    </div>
                                  </label>

                                  {/* Full chunk content */}
                                  <div className="border-t border-[var(--border)]/60 px-4 pb-4 pt-3">
                                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                                      Conteudo do trecho
                                    </p>
                                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 text-[11px] leading-5 text-[var(--foreground-soft)] ring-1 ring-[var(--border)]">
                                      {candidate.content || candidate.contentPreview}
                                    </pre>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-8 py-4">
                  <button
                    className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] px-5 py-2.5 text-sm font-bold text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    onClick={() => setImprovementPhase("config")}
                    type="button"
                  >
                    ← Refazer busca
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-40"
                    disabled={improvementSelectedIds.size === 0}
                    onClick={() => void runImprovementFlow()}
                    type="button"
                  >
                    <Sparkles className="h-4 w-4" />
                    Gerar com {improvementSelectedIds.size} referencia{improvementSelectedIds.size !== 1 ? "s" : ""} selecionada{improvementSelectedIds.size !== 1 ? "s" : ""}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Phase: running */}
            {improvementPhase === "running" ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="shrink-0 flex items-center gap-3 border-b border-[var(--border)] px-8 py-3">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                  <p className="text-sm font-bold text-[var(--accent)]">
                    Gerando sugestao de melhoria com {improvementSources.length} referencia{improvementSources.length !== 1 ? "s" : ""}...
                  </p>
                </div>
                <div className="flex flex-1 overflow-hidden">
                  <div className="flex flex-1 flex-col overflow-hidden border-r border-[var(--border)]">
                    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-muted)] px-5 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                        Original em revisao
                      </p>
                    </div>
                    <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-6 text-[var(--foreground-soft)]">
                      {detail.document.normalizedMarkdown}
                    </pre>
                  </div>
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="shrink-0 border-b border-[var(--accent)]/30 bg-[var(--accent-soft)] px-5 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                        Gerando sugestao...
                      </p>
                    </div>
                    <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-6 text-[var(--foreground)]">
                      {improvementSuggestion}
                      <span className="animate-pulse">▌</span>
                    </pre>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Phase: review */}
            {improvementPhase === "review" ? (
              <>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="flex flex-1 overflow-hidden">
                    {/* Left: original (read-only) */}
                    <div className="flex flex-1 flex-col overflow-hidden border-r border-[var(--border)]">
                      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-muted)] px-5 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                          Original em revisao
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--foreground-soft)]">
                          {detail.document.normalizedMarkdown.length} car. — somente leitura
                        </p>
                      </div>
                      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-6 text-[var(--foreground-soft)]">
                        {detail.document.normalizedMarkdown}
                      </pre>
                    </div>

                    {/* Right: editable suggestion */}
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <div className="shrink-0 border-b border-[var(--accent)]/30 bg-[var(--accent-soft)] px-5 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                          Versao sugerida — editavel
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--foreground-soft)]">
                          {improvementEdited.length} car. — edite livremente antes de aplicar
                        </p>
                      </div>
                      <textarea
                        className="flex-1 resize-none overflow-auto px-5 py-4 font-mono text-xs leading-6 text-[var(--foreground)] outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--accent)]"
                        onChange={(e) => setImprovementEdited(e.target.value)}
                        value={improvementEdited}
                      />
                    </div>
                  </div>

                  {/* Sources used — collapsible */}
                  {improvementSources.length > 0 ? (
                    <div className="shrink-0 border-t border-[var(--border)]">
                      <button
                        className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-[var(--surface-muted)]"
                        onClick={() => setImprovementSourcesOpen((v) => !v)}
                        type="button"
                      >
                        <p className="text-xs font-bold uppercase tracking-wider text-[var(--foreground-soft)]">
                          Referências utilizadas ({improvementSources.length})
                        </p>
                        <span className="text-[10px] text-[var(--muted)]">
                          {improvementSourcesOpen ? "▲ recolher" : "▼ expandir"}
                        </span>
                      </button>
                      {improvementSourcesOpen ? (
                        <div className="max-h-48 overflow-auto border-t border-[var(--border)] px-6 py-3">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {improvementSources.map((src) => (
                              <div
                                key={`${src.documentId}-${src.chunkIndex}`}
                                className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                                    {src.sector}
                                  </span>
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                      src.score >= 0.75
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-amber-100 text-amber-700"
                                    }`}
                                  >
                                    {Math.round(src.score * 100)}%
                                  </span>
                                </div>
                                <p className="mt-1.5 truncate text-xs font-bold text-[var(--foreground-strong)]">
                                  {src.documentTitle}
                                </p>
                                <p className="truncate text-[10px] text-[var(--foreground-soft)]">
                                  {src.headingPathText}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-8 py-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] px-4 py-2.5 text-sm font-bold text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      disabled={isApplyingImprovement}
                      onClick={() => setImprovementPhase("select")}
                      type="button"
                    >
                      ← Ajustar selecao e regerar
                    </button>
                    <p className="text-xs text-[var(--foreground-soft)]">
                      Ao aplicar, o documento retorna ao status{" "}
                      <strong>NEEDS_REVISION</strong> e as aprovacoes sao invalidadas.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)]"
                      disabled={isApplyingImprovement}
                      onClick={() => setImprovementOpen(false)}
                      type="button"
                    >
                      <XCircle className="h-4 w-4" />
                      Descartar sugestao
                    </button>
                    <button
                      className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
                      disabled={isApplyingImprovement || !improvementEdited.trim()}
                      onClick={() => void applyImprovementContent()}
                      type="button"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {isApplyingImprovement ? "Aplicando..." : "Aplicar versao editada"}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {isDiscardModalOpen && detail?.document.status === "REJECTED" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-xl rounded-[2rem] border border-red-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-red-100 p-3 text-red-700">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-red-600">
                  Confirmar descarte
                </p>
                <h3 className="mt-2 text-xl font-black text-[var(--foreground-strong)]">
                  Remover definitivamente este item rejeitado?
                </h3>
                <p className="mt-3 text-sm leading-6 text-[var(--foreground-soft)]">
                  O documento <strong>{detail.document.documentTitle}</strong> sera
                  removido do sistema, e os trechos da area intermediaria de revisao
                  tambem serao apagados. Esta acao nao pode ser desfeita.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Status atual: {detail.document.status}. Somente use esta opcao quando o
              item realmente nao precisar mais permanecer na fila de rejeitados.
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                disabled={pendingAction === "discard"}
                onClick={() => setIsDiscardModalOpen(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-2xl border border-red-300 bg-red-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                disabled={pendingAction === "discard"}
                onClick={() => void discardDocument()}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
                {pendingAction === "discard"
                  ? "Descartando..."
                  : "Confirmar descarte"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
