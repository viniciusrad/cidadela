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
  const initialActiveTab = initialProcessGaps.some((gap) => gap.status === "promoted")
    ? "pending-gaps"
    : documents.length > 0
      ? "documents"
      : "pending-gaps";
  const [activeTab, setActiveTab] = useState<
    "pending-gaps" | "documents" | "answered-gaps" | "unanswered"
  >(initialActiveTab);
  const [gaps, setGaps] = useState(initialProcessGaps);

  const pendingGapsCount = gaps.filter((g) => g.status === "promoted").length;
  const answeredGapsCount = gaps.filter((g) => g.status === "answered").length;
  const unansweredCount = unansweredOpen.length;

  return (
    <div className="space-y-6">
      <div className="premium-panel rounded-[2rem] p-2">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
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
              Documentos
              {documents.length > 0 ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                  {documents.length}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm font-semibold">
              Documentos novos esperando aprovacao antes de entrar no chat.
            </span>
          </button>

          <button
            className={`rounded-[1.5rem] px-5 py-4 text-left transition-colors ${
              activeTab === "pending-gaps"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:bg-white/70 hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => setActiveTab("pending-gaps")}
            type="button"
          >
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em]">
              Perguntas em aberto
              {pendingGapsCount > 0 ? (
                <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] text-cyan-700">
                  {pendingGapsCount}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm font-semibold">
              Pontos que alguem precisa responder para completar o conhecimento.
            </span>
          </button>

          <button
            className={`rounded-[1.5rem] px-5 py-4 text-left transition-colors ${
              activeTab === "answered-gaps"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:bg-white/70 hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => setActiveTab("answered-gaps")}
            type="button"
          >
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em]">
              Perguntas respondidas
              {answeredGapsCount > 0 ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">
                  {answeredGapsCount}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm font-semibold">
              Historico de respostas ja registradas para a curadoria.
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
              Perguntas sem resposta
              {unansweredCount > 0 ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                  {unansweredCount}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm font-semibold">
              Perguntas que o agente nao conseguiu responder e precisam de conteudo.
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
      ) : activeTab === "pending-gaps" ? (
        <ProcessGapsWorkbench
          filter="pending"
          items={gaps}
          selectedSector={selectedSector}
          setItems={setGaps}
        />
      ) : activeTab === "answered-gaps" ? (
        <ProcessGapsWorkbench
          filter="answered"
          items={gaps}
          selectedSector={selectedSector}
          setItems={setGaps}
        />
      ) : (
        <UnansweredQuestionsWorkbench
          answeredItems={unansweredAnswered}
          openItems={unansweredOpen}
        />
      )}
    </div>
  );
}
