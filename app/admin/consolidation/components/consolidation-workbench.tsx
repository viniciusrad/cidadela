"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type {
  ConsolidationArtifactType,
  ConsolidationCandidate,
  ConsolidationDocumentRef,
  ConsolidationEvidenceChunk,
  ConsolidationPreview,
  ConsolidationPreviewRequirement,
  ConsolidationSectorFilter,
  ConsolidationSourceScope,
} from "@/lib/consolidation";

import { CandidateCard } from "./candidate-card";
import { ConsolidationRadar } from "./consolidation-radar";
import { DiscoverForm } from "./discover-form";
import { KpiCard } from "./kpi-card";
import { artifactLabel, chunkKey, documentKey } from "./utils";
import { ALL_SECTOR, type CandidateSelectionState, type PreviewState } from "./types";

export function ConsolidationWorkbench({
  selectedSector,
}: {
  selectedSector: ConsolidationSectorFilter;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState<ConsolidationSectorFilter>(selectedSector);
  const [sourceScope, setSourceScope] = useState<ConsolidationSourceScope>("both");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [candidates, setCandidates] = useState<ConsolidationCandidate[]>([]);
  const [kpis, setKpis] = useState({
    total: 0,
    highConfidence: 0,
    withCriticalGaps: 0,
    existingMatches: 0,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<
    Record<string, Partial<Record<ConsolidationArtifactType, PreviewState>>>
  >({});
  const [selections, setSelections] = useState<Record<string, CandidateSelectionState>>({});
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  useEffect(() => {
    return () => {
      Object.values(abortControllersRef.current).forEach((c) => c.abort());
      abortControllersRef.current = {};
    };
  }, []);

  const buildDefaultSelections = (nextCandidates: ConsolidationCandidate[]) =>
    Object.fromEntries(
      nextCandidates.map((candidate) => [
        candidate.id,
        {
          selectedDocumentKeys: candidate.documentRefs.map(documentKey),
          selectedChunkKeys: candidate.evidenceChunks.map(chunkKey),
        } satisfies CandidateSelectionState,
      ]),
    );

  const clearCandidatePreviews = (candidateId: string) => {
    for (const type of ["sop", "ddp"] as ConsolidationArtifactType[]) {
      const key = `${candidateId}:${type}`;
      abortControllersRef.current[key]?.abort();
      delete abortControllersRef.current[key];
    }
    setPreviews((current) => ({ ...current, [candidateId]: {} }));
  };

  const selectedCandidate = (candidate: ConsolidationCandidate) => {
    const selection = selections[candidate.id];
    if (!selection) return candidate;

    const selectedDocuments = candidate.documentRefs.filter((doc) =>
      selection.selectedDocumentKeys.includes(documentKey(doc)),
    );
    const selectedDocumentKeySet = new Set(selectedDocuments.map(documentKey));
    const selectedChunks = candidate.evidenceChunks.filter((chunk) => {
      const evidenceKey = chunkKey(chunk);
      return (
        selection.selectedChunkKeys.includes(evidenceKey) &&
        selectedDocumentKeySet.has(
          `${chunk.sector}:${chunk.source}:${chunk.sourceDocumentId}`,
        )
      );
    });

    return {
      ...candidate,
      sectorRefs: Array.from(new Set(selectedDocuments.map((doc) => doc.sector))),
      documentRefs: selectedDocuments,
      evidenceChunks: selectedChunks,
    };
  };

  const updateSelection = (
    candidateId: string,
    updater: (current: CandidateSelectionState) => CandidateSelectionState,
  ) => {
    setSelections((current) => {
      const existing = current[candidateId];
      if (!existing) return current;
      return { ...current, [candidateId]: updater(existing) };
    });
    clearCandidatePreviews(candidateId);
    setErrorMessage("");
  };

  const toggleDocumentSelection = (
    candidate: ConsolidationCandidate,
    doc: ConsolidationDocumentRef,
  ) => {
    const docSelectionKey = documentKey(doc);
    const relatedChunkKeys = candidate.evidenceChunks
      .filter(
        (chunk) =>
          `${chunk.sector}:${chunk.source}:${chunk.sourceDocumentId}` === docSelectionKey,
      )
      .map(chunkKey);

    updateSelection(candidate.id, (current) => {
      const isSelected = current.selectedDocumentKeys.includes(docSelectionKey);
      if (isSelected) {
        return {
          selectedDocumentKeys: current.selectedDocumentKeys.filter(
            (key) => key !== docSelectionKey,
          ),
          selectedChunkKeys: current.selectedChunkKeys.filter(
            (key) => !relatedChunkKeys.includes(key),
          ),
        };
      }
      return {
        selectedDocumentKeys: [...current.selectedDocumentKeys, docSelectionKey],
        selectedChunkKeys: Array.from(
          new Set([...current.selectedChunkKeys, ...relatedChunkKeys]),
        ),
      };
    });
  };

  const toggleChunkSelection = (
    candidate: ConsolidationCandidate,
    chunk: ConsolidationEvidenceChunk,
  ) => {
    const evidenceSelectionKey = chunkKey(chunk);
    const parentDocumentKey = `${chunk.sector}:${chunk.source}:${chunk.sourceDocumentId}`;

    updateSelection(candidate.id, (current) => {
      const isSelected = current.selectedChunkKeys.includes(evidenceSelectionKey);
      return {
        selectedDocumentKeys: current.selectedDocumentKeys.includes(parentDocumentKey)
          ? current.selectedDocumentKeys
          : [...current.selectedDocumentKeys, parentDocumentKey],
        selectedChunkKeys: isSelected
          ? current.selectedChunkKeys.filter((key) => key !== evidenceSelectionKey)
          : [...current.selectedChunkKeys, evidenceSelectionKey],
      };
    });
  };

  const pushSector = (nextSector: ConsolidationSectorFilter) => {
    router.push(`/admin/consolidation?sector=${nextSector}`);
  };

  const discover = async () => {
    if (!query.trim()) {
      setErrorMessage("Informe uma busca guiada para consolidar processos.");
      return;
    }
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/admin/consolidation/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, sector, sourceScope }),
      });
      const payload = (await response.json()) as {
        candidates?: ConsolidationCandidate[];
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao analisar a consolidacao.");
      }
      const nextCandidates = payload.candidates ?? [];
      setCandidates(nextCandidates);
      setKpis({
        total: nextCandidates.length,
        highConfidence: nextCandidates.filter((c) => c.confidence >= 0.8).length,
        withCriticalGaps: nextCandidates.filter((c) => c.gaps.length >= 3).length,
        existingMatches: nextCandidates.filter(
          (c) => Object.keys(c.existingArtifactMatches).length > 0,
        ).length,
      });
      setExpandedId(null);
      setPreviews({});
      setSelections(buildDefaultSelections(nextCandidates));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao analisar a consolidacao.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const requestPreview = async (
    candidate: ConsolidationCandidate,
    artifactType: ConsolidationArtifactType,
    clarificationAnswers?: Record<string, string>,
  ) => {
    const filteredCandidate = selectedCandidate(candidate);
    if (filteredCandidate.documentRefs.length === 0) {
      setErrorMessage(
        "Selecione pelo menos um documento de proveniencia antes de gerar a previa.",
      );
      return;
    }
    if (filteredCandidate.evidenceChunks.length === 0) {
      setErrorMessage(
        "Selecione pelo menos um chunk de evidencia antes de gerar a previa.",
      );
      return;
    }

    setErrorMessage("");
    setExpandedId(candidate.id);

    const abortKey = `${candidate.id}:${artifactType}`;
    abortControllersRef.current[abortKey]?.abort();
    const controller = new AbortController();
    abortControllersRef.current[abortKey] = controller;

    setPreviews((current) => ({
      ...current,
      [candidate.id]: {
        ...(current[candidate.id] ?? {}),
        [artifactType]: {
          artifactType,
          title: `${artifactLabel(artifactType)} - ${candidate.processName}`,
          markdown: "",
          status: "preview-loading",
          progress: 5,
          progressLabel: "Iniciando...",
          message: undefined,
        },
      },
    }));

    try {
      const response = await fetch("/api/admin/consolidation/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate: filteredCandidate, artifactType, clarificationAnswers }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errBody = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;

          let event: {
            type: string;
            percent?: number;
            label?: string;
            payload?: unknown;
            message?: string;
          };
          try {
            event = JSON.parse(line.slice(6)) as typeof event;
          } catch {
            continue;
          }

          if (event.type === "progress" && typeof event.percent === "number") {
            setPreviews((current) => {
              const existing = current[candidate.id]?.[artifactType];
              if (!existing || existing.status !== "preview-loading") return current;
              return {
                ...current,
                [candidate.id]: {
                  ...(current[candidate.id] ?? {}),
                  [artifactType]: {
                    ...existing,
                    progress: event.percent,
                    progressLabel: event.label ?? existing.progressLabel,
                  },
                },
              };
            });
          } else if (event.type === "result") {
            const payload = event.payload as Record<string, unknown>;

            if (payload.requiresClarification) {
              const req = payload as unknown as ConsolidationPreviewRequirement;
              setPreviews((current) => ({
                ...current,
                [candidate.id]: {
                  ...(current[candidate.id] ?? {}),
                  [artifactType]: {
                    artifactType,
                    title: req.title,
                    markdown: "",
                    status: "needs-clarification",
                    progress: 0,
                    progressLabel: undefined,
                    message: req.message,
                    clarificationQuestions: req.clarificationQuestions,
                    clarificationAnswers: clarificationAnswers ?? {},
                  },
                },
              }));
            } else {
              const preview = payload as unknown as ConsolidationPreview;
              setPreviews((current) => ({
                ...current,
                [candidate.id]: {
                  ...(current[candidate.id] ?? {}),
                  [artifactType]: {
                    ...preview,
                    status: "ready",
                    progress: 100,
                    progressLabel: "Previa pronta",
                    clarificationQuestions: undefined,
                    clarificationAnswers: clarificationAnswers ?? {},
                  },
                },
              }));
            }
            setExpandedId(candidate.id);
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Falha ao gerar previa.");
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPreviews((current) => ({
        ...current,
        [candidate.id]: {
          ...(current[candidate.id] ?? {}),
          [artifactType]: {
            artifactType,
            title: `${artifactLabel(artifactType)} - ${candidate.processName}`,
            markdown: "",
            status: "ready",
            progress: 0,
            progressLabel: undefined,
            message: error instanceof Error ? error.message : "Falha ao gerar previa.",
          },
        },
      }));
    } finally {
      delete abortControllersRef.current[abortKey];
    }
  };

  const updatePreviewTitle = (
    candidateId: string,
    artifactType: ConsolidationArtifactType,
    title: string,
  ) => {
    setPreviews((current) => ({
      ...current,
      [candidateId]: {
        ...(current[candidateId] ?? {}),
        [artifactType]: {
          ...(current[candidateId]?.[artifactType] as PreviewState),
          title,
        },
      },
    }));
  };

  const updatePreviewMarkdown = (
    candidateId: string,
    artifactType: ConsolidationArtifactType,
    markdown: string,
  ) => {
    setPreviews((current) => ({
      ...current,
      [candidateId]: {
        ...(current[candidateId] ?? {}),
        [artifactType]: {
          ...(current[candidateId]?.[artifactType] as PreviewState),
          markdown,
        },
      },
    }));
  };

  const updateClarificationAnswer = (
    candidateId: string,
    artifactType: ConsolidationArtifactType,
    questionId: string,
    value: string,
  ) => {
    setPreviews((current) => {
      const preview = current[candidateId]?.[artifactType] as PreviewState | undefined;
      if (!preview) return current;
      return {
        ...current,
        [candidateId]: {
          ...(current[candidateId] ?? {}),
          [artifactType]: {
            ...preview,
            clarificationAnswers: {
              ...(preview.clarificationAnswers ?? {}),
              [questionId]: value,
            },
          },
        },
      };
    });
  };

  const sendDraft = async (
    candidate: ConsolidationCandidate,
    artifactType: ConsolidationArtifactType,
  ) => {
    const preview = previews[candidate.id]?.[artifactType];
    const filteredCandidate = selectedCandidate(candidate);
    if (!preview?.markdown.trim()) return;
    if (
      filteredCandidate.documentRefs.length === 0 ||
      filteredCandidate.evidenceChunks.length === 0
    ) {
      setErrorMessage(
        "A selecao da base ficou vazia. Gere uma nova previa com documentos e chunks validos.",
      );
      return;
    }

    setPreviews((current) => ({
      ...current,
      [candidate.id]: {
        ...(current[candidate.id] ?? {}),
        [artifactType]: { ...preview, status: "draft-sending", message: undefined },
      },
    }));

    try {
      const targetSector =
        sector === ALL_SECTOR ? filteredCandidate.documentRefs[0]?.sector : sector;
      const response = await fetch("/api/admin/consolidation/create-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sector: targetSector,
          candidate: filteredCandidate,
          artifactType,
          title: preview.title,
          markdown: preview.markdown,
        }),
      });
      const payload = (await response.json()) as {
        curationDocumentId?: string;
        status?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao enviar rascunho.");
      }
      setPreviews((current) => ({
        ...current,
        [candidate.id]: {
          ...(current[candidate.id] ?? {}),
          [artifactType]: {
            ...preview,
            status: "ready",
            progress: 100,
            isError: false,
            message: `Enviado para curadoria (${payload.status ?? "IN_REVIEW"}).`,
          },
        },
      }));
    } catch (error) {
      const msg =
        error instanceof Error && error.message
          ? error.message
          : "Falha ao enviar rascunho para curadoria.";
      setPreviews((current) => ({
        ...current,
        [candidate.id]: {
          ...(current[candidate.id] ?? {}),
          [artifactType]: {
            ...preview,
            status: "ready",
            progress: preview.progress ?? 100,
            isError: true,
            message: msg,
          },
        },
      }));
    }
  };

  return (
    <div className="space-y-6">
      <DiscoverForm
        errorMessage={errorMessage}
        isLoading={isLoading}
        onDiscover={() => void discover()}
        onQueryChange={setQuery}
        onSectorChange={(nextSector) => {
          setSector(nextSector);
          pushSector(nextSector);
        }}
        onSourceScopeChange={setSourceScope}
        query={query}
        sector={sector}
        sourceScope={sourceScope}
      />

      {candidates.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Candidatos Descobertos" value={kpis.total} />
          <KpiCard label="Alta Confiança (>= 80%)" tone="success" value={kpis.highConfidence} />
          <KpiCard label="Gaps de Cobertura" tone="alert" value={kpis.withCriticalGaps} />
          <KpiCard label="Artefatos Existentes" value={kpis.existingMatches} />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="premium-panel rounded-[2rem] p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Consolidacao de processos
              </p>
              <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                Candidatos encontrados
              </h3>
            </div>
            <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-bold text-[var(--foreground-soft)]">
              {candidates.length} candidato(s)
            </span>
          </div>

          {!isLoading && candidates.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--foreground-soft)]">
              Execute uma busca guiada para consolidar processos, SOPs e DDPs a partir das
              evidencias promovidas e de staging.
            </div>
          ) : null}

          <div className="mt-6 space-y-4">
            {candidates.map((candidate) => {
              const isExpanded = expandedId === candidate.id;
              const candidatePreviews = previews[candidate.id] ?? {};
              const candidateSelection = selections[candidate.id];
              const selectedDocumentKeys = new Set(
                candidateSelection?.selectedDocumentKeys ??
                  candidate.documentRefs.map(documentKey),
              );
              const selectedChunkKeys = new Set(
                candidateSelection?.selectedChunkKeys ??
                  candidate.evidenceChunks.map(chunkKey),
              );
              const filteredCandidate = selectedCandidate(candidate);

              return (
                <CandidateCard
                  candidate={candidate}
                  candidatePreviews={candidatePreviews}
                  filteredCandidate={filteredCandidate}
                  isExpanded={isExpanded}
                  key={candidate.id}
                  onRequestPreview={(artifactType, answers) =>
                    void requestPreview(candidate, artifactType, answers)
                  }
                  onSendDraft={(artifactType) => void sendDraft(candidate, artifactType)}
                  onToggleChunk={(chunk) => toggleChunkSelection(candidate, chunk)}
                  onToggleDocument={(doc) => toggleDocumentSelection(candidate, doc)}
                  onToggleExpand={() =>
                    setExpandedId(isExpanded ? null : candidate.id)
                  }
                  onUpdateClarificationAnswer={(artifactType, questionId, value) =>
                    updateClarificationAnswer(candidate.id, artifactType, questionId, value)
                  }
                  onUpdateMarkdown={(artifactType, markdown) =>
                    updatePreviewMarkdown(candidate.id, artifactType, markdown)
                  }
                  onUpdateTitle={(artifactType, title) =>
                    updatePreviewTitle(candidate.id, artifactType, title)
                  }
                  selectedChunkKeys={selectedChunkKeys}
                  selectedDocumentKeys={selectedDocumentKeys}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <ConsolidationRadar
            candidates={candidates}
            onSelectCandidate={setExpandedId}
          />
        </div>
      </div>
    </div>
  );
}
