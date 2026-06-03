"use client";

import { useCallback, useState } from "react";

type Situation = {
  id: string;
  when: string;
  tags: string[];
};

type RelationTagInputProps = {
  value: string;
  onChange: (json: string) => void;
  onSave: () => void;
  disabled?: boolean;
  placeholder?: string;
};

const MAX_SITUATIONS = 10;
const MAX_TAGS = 3;

function parseSituations(value: string): Situation[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is Situation =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Situation).id === "string" &&
          typeof (item as Situation).when === "string" &&
          Array.isArray((item as Situation).tags),
      );
    }
    return [];
  } catch {
    return [];
  }
}

export function RelationTagInput({
  value,
  onChange,
  onSave,
  disabled = false,
  placeholder = "Ex: Quando o sistema X cai de madrugada...",
}: RelationTagInputProps) {
  const situations = parseSituations(value);
  const [isAdding, setIsAdding] = useState(false);
  const [newWhen, setNewWhen] = useState("");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const emitChange = useCallback(
    (updated: Situation[]) => {
      onChange(JSON.stringify(updated));
    },
    [onChange],
  );

  function addTag() {
    const trimmed = tagInput.trim().toLowerCase();
    if (!trimmed || newTags.includes(trimmed) || newTags.length >= MAX_TAGS) return;
    setNewTags((current) => [...current, trimmed]);
    setTagInput("");
  }

  function handleTagKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    }
  }

  function removeNewTag(tag: string) {
    setNewTags((current) => current.filter((t) => t !== tag));
  }

  function commitAddition() {
    const trimmedWhen = newWhen.trim();
    if (!trimmedWhen) return;
    const newSituation: Situation = {
      id: crypto.randomUUID(),
      when: trimmedWhen,
      tags: newTags,
    };
    const updated = [...situations, newSituation];
    emitChange(updated);
    setIsAdding(false);
    setNewWhen("");
    setNewTags([]);
    setTagInput("");
  }

  function removeSituation(id: string) {
    const updated = situations.filter((s) => s.id !== id);
    emitChange(updated);
  }

  function cancelAddition() {
    setIsAdding(false);
    setNewWhen("");
    setNewTags([]);
    setTagInput("");
  }

  return (
    <div className="space-y-3">
      {situations.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-bold text-[var(--foreground-soft)]">
            Situações registradas ({situations.length}):
          </p>
          <ul className="space-y-2">
            {situations.map((situation) => (
              <li
                className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2"
                key={situation.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--foreground-strong)]">
                    {situation.when}
                  </p>
                  {situation.tags.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {situation.tags.map((tag) => (
                        <span
                          className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {!disabled ? (
                  <button
                    className="mt-0.5 shrink-0 text-[var(--muted)] transition-colors hover:text-red-600"
                    onClick={() => removeSituation(situation.id)}
                    title="Remover situação"
                    type="button"
                  >
                    <span aria-hidden className="text-sm font-black">
                      ×
                    </span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-[var(--foreground-soft)]">
          Nenhuma situação registrada ainda.
        </p>
      )}

      {isAdding ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/30 p-4 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-[var(--foreground-soft)]">
              Descreva a situação:
            </label>
            <textarea
              className="min-h-20 w-full resize-y rounded-xl border border-amber-200 bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-amber-400"
              disabled={disabled}
              onChange={(e) => setNewWhen(e.target.value)}
              placeholder={placeholder}
              value={newWhen}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-[var(--foreground-soft)]">
              Tags de domínio (máx. {MAX_TAGS}):
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                disabled={disabled || newTags.length >= MAX_TAGS}
                onKeyDown={handleTagKeyDown}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Digite e pressione Enter"
                value={tagInput}
              />
              <button
                className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-700 transition-colors hover:border-amber-400 disabled:opacity-50"
                disabled={disabled || !tagInput.trim() || newTags.length >= MAX_TAGS}
                onClick={addTag}
                type="button"
              >
                +
              </button>
            </div>
            {newTags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {newTags.map((tag) => (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                    key={tag}
                  >
                    {tag}
                    <button
                      className="hover:text-red-600"
                      onClick={() => removeNewTag(tag)}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
              disabled={disabled || !newWhen.trim()}
              onClick={commitAddition}
              type="button"
            >
              Adicionar
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-xs font-bold text-[var(--foreground-soft)] transition-colors hover:border-[var(--border-strong)]"
              disabled={disabled}
              onClick={cancelAddition}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!isAdding && !disabled && situations.length < MAX_SITUATIONS ? (
          <button
            className="inline-flex items-center gap-1 rounded-xl border border-dashed border-amber-300 px-3 py-2 text-xs font-bold text-amber-700 transition-colors hover:border-amber-400 hover:bg-amber-50"
            onClick={() => setIsAdding(true)}
            type="button"
          >
            + Adicionar situação
          </button>
        ) : null}

        {situations.length > 0 && !disabled ? (
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            onClick={onSave}
            type="button"
          >
            Salvar
          </button>
        ) : null}
      </div>
    </div>
  );
}
