"use client";

import { CheckCircle2, HelpCircle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  type DocumentType,
} from "@/lib/document-types";

type TypeBadgeProps = {
  documentType: string | null | undefined;
  classificationSource?: string | null;
  classificationConfidence?: number | null;
  canEdit?: boolean;
  onTypeChange?: (newType: string) => void;
};

const TYPE_LIST = [...DOCUMENT_TYPES] as DocumentType[];

export function TypeBadge({
  documentType,
  classificationSource,
  classificationConfidence,
  canEdit = false,
  onTypeChange,
}: TypeBadgeProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<string>(documentType ?? "generico");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!dropdownOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  const openDropdown = useCallback(() => {
    setSelectedType(documentType ?? "generico");
    setDropdownOpen(true);
  }, [documentType]);

  const confirmSelection = useCallback(() => {
    setDropdownOpen(false);
    onTypeChange?.(selectedType);
  }, [selectedType, onTypeChange]);

  const isHuman = classificationSource === "human";
  const confidence = classificationConfidence ?? 0;
  const hasType =
    !!documentType &&
    documentType !== "generico";

  // Determine visual state
  let state: "amber" | "green" | "gray";
  if (isHuman && hasType) {
    state = "green";
  } else if (!isHuman && hasType && confidence >= 0.5) {
    state = "amber";
  } else {
    state = "gray";
  }

  const label = hasType
    ? (DOCUMENT_TYPE_LABELS[documentType as DocumentType] ?? documentType!)
    : "Tipo não identificado";

  return (
    <div className="relative inline-block" ref={containerRef}>
      <div
        className={`inline-flex flex-col rounded-xl border px-3 py-2 ${
          state === "green"
            ? "border-emerald-400 bg-emerald-50/60"
            : state === "amber"
              ? "border-dashed border-amber-400 bg-amber-50/60"
              : "border-dashed border-[var(--border)] bg-[var(--surface-muted)]"
        }`}
      >
        <div className="flex items-center gap-2">
          {state === "green" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : state === "amber" ? (
            <Sparkles className="h-4 w-4 shrink-0 text-amber-600" />
          ) : (
            <HelpCircle className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          )}

          <span
            className={`text-xs font-bold ${
              state === "green"
                ? "text-emerald-700"
                : state === "amber"
                  ? "text-amber-700"
                  : "text-[var(--foreground-soft)]"
            }`}
          >
            {state === "amber" && confidence > 0
              ? `${label} · ${Math.round(confidence * 100)}%`
              : label}
          </span>

          {canEdit && (state === "amber" || state === "green") ? (
            <button
              className="ml-1 text-[10px] font-bold text-[var(--accent)] underline-offset-2 hover:underline"
              onClick={openDropdown}
              type="button"
            >
              [corrigir]
            </button>
          ) : null}

          {canEdit && state === "gray" ? (
            <button
              className="ml-1 text-[10px] font-bold text-[var(--accent)] underline-offset-2 hover:underline"
              onClick={openDropdown}
              type="button"
            >
              [definir tipo]
            </button>
          ) : null}
        </div>

        {state === "amber" ? (
          <p className="ml-6 mt-0.5 text-[10px] text-amber-600">
            Detectado automaticamente
          </p>
        ) : state === "gray" ? (
          <p className="ml-6 mt-0.5 text-[10px] text-[var(--muted)]">
            Defina o tipo para ativar as perguntas de enriquecimento
          </p>
        ) : null}
      </div>

      {dropdownOpen ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-2xl border border-[var(--border)] bg-white p-4 shadow-xl">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Selecione o tipo do documento
          </p>
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {TYPE_LIST.map((type) => (
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                  selectedType === type
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "hover:bg-[var(--surface-muted)]"
                }`}
                key={type}
              >
                <input
                  checked={selectedType === type}
                  className="accent-[var(--accent)]"
                  name="doc-type-select"
                  onChange={() => setSelectedType(type)}
                  type="radio"
                  value={type}
                />
                <span className="text-sm font-bold">
                  {DOCUMENT_TYPE_LABELS[type] ?? type}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[var(--accent-strong)]"
              onClick={confirmSelection}
              type="button"
            >
              Confirmar
            </button>
            <button
              className="flex-1 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--foreground-soft)] transition-colors hover:border-[var(--border-strong)]"
              onClick={() => setDropdownOpen(false)}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
