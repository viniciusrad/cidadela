"use client";

import { useState } from "react";

import { CurationReviewWorkbench } from "@/components/curation-review-workbench";
import {
  ProcessGapsWorkbench,
  type ProcessGapInboxItem,
} from "@/components/process-gaps-workbench";
import {
  UnansweredQuestionsWorkbench,
  type UnansweredQuestionItem,
} from "@/components/unanswered-questions-workbench";
import { type Sector, type UserRole } from "@/lib/domain";
import type { DocumentType } from "@/lib/document-types";

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

type MainTab = "documents" | "process-gaps" | "unanswered";
type GapSubTab = "pending" | "answered";

export function CurationTabs({
  documents,
  processGaps: initialProcessGaps,
  unansweredOpen,
  unansweredAnswered,
  sectorOptions,
  user,
  selectedSector = "todos",
}: {
  documents: InitialCurationDocument[];
  processGaps: ProcessGapInboxItem[];
  unansweredOpen: UnansweredQuestionItem[];
  unansweredAnswered: UnansweredQuestionItem[];
  sectorOptions: SectorOption[];
  user: SessionUser;
  selectedSector?: string;
}) {
  const hasPendingGaps = initialProcessGaps.some((gap) => gap.status === "promoted");
  const initialMainTab: MainTab = hasPendingGaps
    ? "process-gaps"
    : documents.length > 0
      ? "documents"
      : "process-gaps";

  const [activeTab, setActiveTab] = useState<MainTab>(initialMainTab);
  const [gapSubTab, setGapSubTab] = useState<GapSubTab>("pending");
  const [gaps, setGaps] = useState(initialProcessGaps);

  const pendingGapsCount = gaps.filter((g) => g.status === "promoted").length;
  const answeredGapsCount = gaps.filter((g) => g.status === "answered").length;
  const unansweredCount = unansweredOpen.length;

  const IN_QUEUE_STATUSES = new Set(["STAGED", "IN_REVIEW", "NEEDS_REVISION", "READY_FOR_APPROVAL"]);
  const docsInQueueCount = documents.filter((d) => IN_QUEUE_STATUSES.has(d.status)).length;

  return (
    <div className="space-y-6">
      <div className="premium-panel rounded-[2rem] p-2">
        <div className="grid gap-2 md:grid-cols-3">
          <button
            className={`rounded-[1.5rem] px-5 py-4 text-left transition-colors ${
              activeTab === "documents"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:bg-white/70 hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => setActiveTab("documents")}
            type="button"
          >
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em]">
              Aprovacao de Docs
              {docsInQueueCount > 0 ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                  {docsInQueueCount}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm font-semibold">
              Documentos enviados aguardando revisao e promocao para o chat.
            </span>
          </button>

          <button
            className={`rounded-[1.5rem] px-5 py-4 text-left transition-colors ${
              activeTab === "process-gaps"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:bg-white/70 hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => setActiveTab("process-gaps")}
            type="button"
          >
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em]">
              Lacunas de Processo
              {pendingGapsCount > 0 ? (
                <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] text-cyan-700">
                  {pendingGapsCount}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm font-semibold">
              Perguntas do mapa de automacao para fechar pontos de documentacao.
            </span>
          </button>

          <button
            className={`rounded-[1.5rem] px-5 py-4 text-left transition-colors ${
              activeTab === "unanswered"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:bg-white/70 hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => setActiveTab("unanswered")}
            type="button"
          >
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em]">
              Falhas do Chat
              {unansweredCount > 0 ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                  {unansweredCount}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm font-semibold">
              Perguntas feitas no chat que o agente nao soube responder — precisam de conteudo novo.
            </span>
          </button>
        </div>
      </div>

      {activeTab === "documents" ? (
        <CurationReviewWorkbench
          documents={documents}
          selectedSector={selectedSector}
          sectorOptions={sectorOptions}
          user={user}
        />
      ) : activeTab === "process-gaps" ? (
        <div className="space-y-4">
          <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
            <button
              className={`rounded-xl px-5 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors ${
                gapSubTab === "pending"
                  ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                  : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
              }`}
              onClick={() => setGapSubTab("pending")}
              type="button"
            >
              Aguardando resposta
              {pendingGapsCount > 0 ? (
                <span className="ml-2 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] text-cyan-700">
                  {pendingGapsCount}
                </span>
              ) : null}
            </button>
            <button
              className={`rounded-xl px-5 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors ${
                gapSubTab === "answered"
                  ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                  : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
              }`}
              onClick={() => setGapSubTab("answered")}
              type="button"
            >
              Ja respondidas
              {answeredGapsCount > 0 ? (
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">
                  {answeredGapsCount}
                </span>
              ) : null}
            </button>
          </div>

          <ProcessGapsWorkbench
            filter={gapSubTab}
            items={gaps}
            selectedSector={selectedSector}
            setItems={setGaps}
          />
        </div>
      ) : (
        <UnansweredQuestionsWorkbench
          answeredItems={unansweredAnswered}
          openItems={unansweredOpen}
        />
      )}
    </div>
  );
}
