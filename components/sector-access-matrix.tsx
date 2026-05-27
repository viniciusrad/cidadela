"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, X } from "lucide-react";

type SectorDef = {
  slug: string;
  displayName: string;
  enabled: boolean;
};

type AccessRule = {
  fromSector: string;
  toSector: string;
  accessLevel: "public" | "full" | "denied";
  routingKeywords: string[];
  enabled: boolean;
};

type CellKey = `${string}->${string}`;

type EditState = {
  fromSlug: string;
  toSlug: string;
  accessLevel: AccessRule["accessLevel"];
  routingKeywords: string;
  enabled: boolean;
};

const ACCESS_COLORS: Record<string, string> = {
  public: "bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100",
  full: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100",
  denied: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
  none: "bg-[var(--surface-muted)] text-[var(--muted)] border-[var(--border)] hover:bg-white",
};

const ACCESS_LABELS: Record<string, string> = {
  public: "public",
  full: "full",
  denied: "denied",
  none: "—",
};

export function SectorAccessMatrix() {
  const [sectors, setSectors] = useState<SectorDef[]>([]);
  const [rulesMap, setRulesMap] = useState<Map<CellKey, AccessRule>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sectorsResp = await fetch("/api/admin/sectors", { cache: "no-store" });
      if (!sectorsResp.ok) throw new Error(`Falha ao carregar setores (${sectorsResp.status})`);
      const { sectors: sectorList } = (await sectorsResp.json()) as {
        sectors: SectorDef[];
      };
      setSectors(sectorList.filter((s) => s.enabled));

      const rulesResults = await Promise.all(
        sectorList
          .filter((s) => s.enabled)
          .map(async (s) => {
            const r = await fetch(`/api/admin/sectors/${s.slug}/access`, {
              cache: "no-store",
            });
            if (!r.ok) return [] as AccessRule[];
            const data = (await r.json()) as { rules: AccessRule[] };
            return data.rules;
          }),
      );

      const map = new Map<CellKey, AccessRule>();
      for (const rules of rulesResults) {
        for (const rule of rules) {
          map.set(`${rule.fromSector}->${rule.toSector}`, rule);
        }
      }
      setRulesMap(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar matriz.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sectorsResp = await fetch("/api/admin/sectors", { cache: "no-store" });
        if (!sectorsResp.ok)
          throw new Error(`Falha ao carregar setores (${sectorsResp.status})`);
        const { sectors: sectorList } = (await sectorsResp.json()) as {
          sectors: SectorDef[];
        };
        const enabled = sectorList.filter((s) => s.enabled);

        const rulesResults = await Promise.all(
          enabled.map(async (s) => {
            const r = await fetch(`/api/admin/sectors/${s.slug}/access`, {
              cache: "no-store",
            });
            if (!r.ok) return [] as AccessRule[];
            const data = (await r.json()) as { rules: AccessRule[] };
            return data.rules;
          }),
        );

        if (cancelled) return;
        const map = new Map<CellKey, AccessRule>();
        for (const rules of rulesResults) {
          for (const rule of rules) {
            map.set(`${rule.fromSector}->${rule.toSector}`, rule);
          }
        }
        setSectors(enabled);
        setRulesMap(map);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Erro ao carregar matriz.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openEdit(from: SectorDef, to: SectorDef) {
    if (from.slug === to.slug) return;
    const existing = rulesMap.get(`${from.slug}->${to.slug}`);
    setEditing({
      fromSlug: from.slug,
      toSlug: to.slug,
      accessLevel: existing?.accessLevel ?? "public",
      routingKeywords: (existing?.routingKeywords ?? []).join(", "),
      enabled: existing?.enabled ?? true,
    });
    setSaveError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      const keywords = editing.routingKeywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      const response = await fetch(`/api/admin/sectors/${editing.fromSlug}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toSector: editing.toSlug,
          accessLevel: editing.accessLevel,
          routingKeywords: keywords,
          enabled: editing.enabled,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Erro ${response.status}`);
      }
      setEditing(null);
      await refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-[var(--foreground-soft)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando matriz...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--foreground-soft)]">
        Clique em uma celula para configurar a regra de acesso intersetorial. Linhas = origem, colunas = destino.
      </p>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-soft)]">
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                De \ Para
              </th>
              {sectors.map((to) => (
                <th
                  className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]"
                  key={to.slug}
                >
                  {to.displayName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectors.map((from) => (
              <tr
                className="border-b border-[var(--border)] last:border-0"
                key={from.slug}
              >
                <td className="whitespace-nowrap px-3 py-2 font-bold text-[var(--foreground-soft)]">
                  {from.displayName}
                </td>
                {sectors.map((to) => {
                  if (from.slug === to.slug) {
                    return (
                      <td
                        className="px-2 py-2 text-center text-[var(--border)]"
                        key={to.slug}
                      >
                        ·
                      </td>
                    );
                  }
                  const rule = rulesMap.get(`${from.slug}->${to.slug}`);
                  const level = rule?.accessLevel ?? "none";
                  const isDisabled = rule && !rule.enabled;
                  return (
                    <td className="px-1 py-1 text-center" key={to.slug}>
                      <button
                        className={`w-full rounded-md border px-2 py-1 text-[10px] font-bold transition-colors ${
                          isDisabled
                            ? "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)] opacity-50"
                            : (ACCESS_COLORS[level] ?? ACCESS_COLORS.none)
                        }`}
                        onClick={() => openEdit(from, to)}
                        type="button"
                      >
                        {isDisabled ? "off" : ACCESS_LABELS[level]}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-[var(--foreground-strong)]">
                {sectors.find((s) => s.slug === editing.fromSlug)?.displayName} →{" "}
                {sectors.find((s) => s.slug === editing.toSlug)?.displayName}
              </p>
              <button
                className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)]"
                onClick={() => setEditing(null)}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  Nivel de acesso
                </span>
                <select
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev
                        ? {
                            ...prev,
                            accessLevel: e.target.value as AccessRule["accessLevel"],
                          }
                        : prev,
                    )
                  }
                  value={editing.accessLevel}
                >
                  <option value="public">public — acesso padrao</option>
                  <option value="full">full — acesso ampliado</option>
                  <option value="denied">denied — bloqueado</option>
                </select>
              </label>

              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  Palavras-chave de roteamento
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev ? { ...prev, routingKeywords: e.target.value } : prev,
                    )
                  }
                  placeholder="senha, incidente, acesso (separadas por virgula)"
                  value={editing.routingKeywords}
                />
                <span className="mt-1 block text-[11px] text-[var(--muted)]">
                  Quando a pergunta contiver esses termos, delega automaticamente para este setor.
                </span>
              </label>

              <label className="flex items-center gap-2 text-xs font-bold text-[var(--foreground-soft)]">
                <input
                  checked={editing.enabled}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev ? { ...prev, enabled: e.target.checked } : prev,
                    )
                  }
                  type="checkbox"
                />
                Regra ativa
              </label>
            </div>

            {saveError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
                {saveError}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--foreground-soft)] hover:bg-[var(--surface-muted)]"
                onClick={() => setEditing(null)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                disabled={saving}
                onClick={saveEdit}
                type="button"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
