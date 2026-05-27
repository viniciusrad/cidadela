"use client";

import { FormEvent, useMemo, useState } from "react";
import { Save, Trash2 } from "lucide-react";

import { SECTOR_LABELS } from "@/lib/labels";
import { SECTORS, type Sector } from "@/lib/domain";

type KnowledgeOwnerRow = {
  id: string;
  topic: string;
  sector: Sector;
  userEmail: string;
  createdAt: string;
};

type TopicOption = {
  topic: string;
  sector: string;
};

type ApiPayload = {
  owners: KnowledgeOwnerRow[];
  topics: TopicOption[];
};

const EMPTY_FORM = {
  id: "",
  topic: "",
  sector: "desenvolvimento" as Sector,
  userEmail: "",
};

export function KnowledgeOwnersManager({
  initialOwners,
  initialTopics,
}: {
  initialOwners: KnowledgeOwnerRow[];
  initialTopics: TopicOption[];
}) {
  const [owners, setOwners] = useState<KnowledgeOwnerRow[]>(initialOwners);
  const [topics, setTopics] = useState<TopicOption[]>(initialTopics);
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    setIsLoading(true);
    const response = await fetch("/api/admin/knowledge-owners");
    if (!response.ok) {
      setStatus("Nao foi possivel carregar os donos do conhecimento.");
      setIsLoading(false);
      return;
    }
    const payload = (await response.json()) as ApiPayload;
    setOwners(payload.owners);
    setTopics(payload.topics);
    setIsLoading(false);
  }

  const topicSuggestions = useMemo(
    () =>
      topics
        .filter((item) => item.sector === form.sector)
        .map((item) => item.topic),
    [form.sector, topics],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatus(null);

    const response = await fetch("/api/admin/knowledge-owners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.id || undefined,
        topic: form.topic,
        sector: form.sector,
        userEmail: form.userEmail,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      setStatus(payload?.message ?? "Nao foi possivel salvar.");
      setIsSaving(false);
      return;
    }

    setForm(EMPTY_FORM);
    setStatus("Dono do conhecimento salvo.");
    setIsSaving(false);
    await load();
  }

  async function removeOwner(id: string) {
    setStatus(null);
    const response = await fetch(
      `/api/admin/knowledge-owners?id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      setStatus("Nao foi possivel remover.");
      return;
    }

    await load();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <section className="premium-panel rounded-lg p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
          Cadastro
        </p>
        <h2 className="mt-2 text-lg font-black text-[var(--foreground-strong)]">
          Dono por topico
        </h2>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              Setor
            </span>
            <select
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-bold"
              value={form.sector}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  sector: event.target.value as Sector,
                }))
              }
            >
              {SECTORS.map((sector) => (
                <option key={sector} value={sector}>
                  {SECTOR_LABELS[sector]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              Topico
            </span>
            <input
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
              list="knowledge-owner-topics"
              maxLength={120}
              required
              value={form.topic}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, topic: event.target.value }))
              }
            />
            <datalist id="knowledge-owner-topics">
              {topicSuggestions.map((topic) => (
                <option key={topic} value={topic} />
              ))}
            </datalist>
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              E-mail do responsavel
            </span>
            <input
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
              maxLength={240}
              required
              type="email"
              value={form.userEmail}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, userEmail: event.target.value }))
              }
            />
          </label>

          {status ? (
            <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--foreground-soft)]">
              {status}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-black text-white disabled:opacity-50"
              disabled={isSaving}
              type="submit"
            >
              <Save aria-hidden="true" className="h-4 w-4" />
              {isSaving ? "Salvando" : form.id ? "Atualizar" : "Salvar"}
            </button>
            {form.id ? (
              <button
                className="rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-bold"
                type="button"
                onClick={() => setForm(EMPTY_FORM)}
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="premium-panel rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
              Owners ativos
            </p>
            <h2 className="mt-2 text-lg font-black text-[var(--foreground-strong)]">
              {owners.length} vinculos
            </h2>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-soft)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Topico</th>
                <th className="px-4 py-3">Setor</th>
                <th className="px-4 py-3">Responsavel</th>
                <th className="px-4 py-3 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-4 py-5 text-[var(--foreground-soft)]" colSpan={4}>
                    Carregando...
                  </td>
                </tr>
              ) : owners.length === 0 ? (
                <tr>
                  <td className="px-4 py-5 text-[var(--foreground-soft)]" colSpan={4}>
                    Nenhum dono cadastrado.
                  </td>
                </tr>
              ) : (
                owners.map((owner) => (
                  <tr
                    className="border-t border-[var(--border)] bg-white"
                    key={owner.id}
                  >
                    <td className="px-4 py-3 font-black text-[var(--foreground-strong)]">
                      {owner.topic}
                    </td>
                    <td className="px-4 py-3 text-[var(--foreground-soft)]">
                      {SECTOR_LABELS[owner.sector]}
                    </td>
                    <td className="px-4 py-3 text-[var(--foreground-soft)]">
                      {owner.userEmail}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold"
                          type="button"
                          onClick={() =>
                            setForm({
                              id: owner.id,
                              topic: owner.topic,
                              sector: owner.sector,
                              userEmail: owner.userEmail,
                            })
                          }
                        >
                          Editar
                        </button>
                        <button
                          aria-label={`Remover ${owner.topic}`}
                          className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700"
                          type="button"
                          onClick={() => void removeOwner(owner.id)}
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
