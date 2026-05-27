"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  History,
  Loader2,
  RefreshCw,
  Search,
  Undo2,
  UserCog,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DocumentDetailModal } from "@/components/document-detail-modal";

type PersonSummary = {
  name: string;
  documentCount: number;
  chunkCount: number;
  sectors: string[];
};

type PersonDocument = {
  documentId: string;
  sourceDocumentId: string;
  title: string;
  sector: string;
  chunkCount: number;
  previewSnippets: Array<{
    pointId: string;
    headingPath: string;
    excerpt: string;
  }>;
};

type DetailResponse = {
  name: string;
  documents: PersonDocument[];
};

type ReclassifyResult = {
  personName: string;
  targetType: string;
  targetName: string;
  perDocument: Array<{
    documentId: string;
    chunksRewritten: number;
    chunkEdges: number;
    error?: string;
  }>;
  personDropped: boolean;
};

type RecentReclassification = {
  personName: string;
  targetType: TargetType;
  targetName: string;
  documentCount: number;
  lastUpdatedAt: string | null;
};

type UndoResult = {
  personName: string;
  targetType: string;
  targetName: string;
  documentsAffected: number;
  perDocument: Array<{
    documentId: string;
    chunksReverted: number;
    error?: string;
  }>;
  graph: {
    documentEdges: number;
    chunkEdges: number;
    targetDropped: boolean;
  };
};

type TargetType = "Person" | "Concept" | "Procedure" | "System" | "Regulation";

const TARGET_OPTIONS: Array<{ value: TargetType; label: string; hint: string }> = [
  {
    value: "Person",
    label: "Pessoa (corrigir / renomear)",
    hint: "Mantem como pessoa. Use para corrigir grafia ou fundir duplicatas.",
  },
  {
    value: "System",
    label: "Sistema",
    hint: "Ex: SAP, Cervello, Pedido Eletronico.",
  },
  {
    value: "Concept",
    label: "Conceito",
    hint: "Termo tecnico ou de dominio.",
  },
  {
    value: "Procedure",
    label: "Processo",
    hint: "Procedimento ou rotina descrita.",
  },
  {
    value: "Regulation",
    label: "Regulamentação",
    hint: "Norma, politica, lei.",
  },
];

export function PeopleReclassifyPanel() {
  const [persons, setPersons] = useState<PersonSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [targetType, setTargetType] = useState<TargetType>("Person");
  const [targetName, setTargetName] = useState("");
  const [pickedDocs, setPickedDocs] = useState<Set<string>>(new Set());
  const [deleteOriginal, setDeleteOriginal] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReclassifyResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [history, setHistory] = useState<RecentReclassification[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [undoingKey, setUndoingKey] = useState<string | null>(null);
  const [undoResult, setUndoResult] = useState<UndoResult | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  const [previewDoc, setPreviewDoc] = useState<PersonDocument | null>(null);

  const loadPersons = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch("/api/admin/people");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || `Erro ${res.status}`);
      }
      const data = (await res.json()) as { persons: PersonSummary[] };
      setPersons(data.persons);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Erro ao carregar.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await fetch("/api/admin/people/reclassifications");
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message || `Erro ${res.status}`);
      }
      const data = (await res.json()) as { items: RecentReclassification[] };
      setHistory(data.items);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Erro ao carregar.");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPersons();
    loadHistory();
  }, [loadPersons, loadHistory]);

  const loadDetail = useCallback(async (name: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    setDetail(null);
    setPickedDocs(new Set());
    setResult(null);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/admin/people/${encodeURIComponent(name)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || `Erro ${res.status}`);
      }
      const data = (await res.json()) as DetailResponse;
      setDetail(data);
      setPickedDocs(new Set(data.documents.map((d) => d.documentId)));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Erro ao carregar.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  function handleSelect(name: string) {
    setSelected(name);
    loadDetail(name);
  }

  function togglePicked(documentId: string) {
    setConfirming(false);
    setPickedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return persons;
    return persons.filter((p) => p.name.toLowerCase().includes(q));
  }, [persons, filter]);

  function requestConfirm() {
    setSubmitError(null);
    setResult(null);
    setConfirming(true);
  }

  function cancelConfirm() {
    setConfirming(false);
  }

  async function handleSubmit() {
    if (!selected || pickedDocs.size === 0 || !targetName.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/people/${encodeURIComponent(selected)}/reclassify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetType,
            targetName: targetName.trim(),
            documentIds: Array.from(pickedDocs),
            deleteOriginal,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || `Erro ${res.status}`);
      }
      const data = (await res.json()) as ReclassifyResult;
      setResult(data);
      setConfirming(false);
      await Promise.all([loadPersons(), loadHistory()]);
      if (data.personDropped) {
        setSelected(null);
        setDetail(null);
      } else {
        await loadDetail(selected);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erro ao aplicar.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUndo(item: RecentReclassification) {
    const key = `${item.personName}|${item.targetType}|${item.targetName}`;
    setUndoingKey(key);
    setUndoError(null);
    setUndoResult(null);
    try {
      const res = await fetch("/api/admin/people/reclassifications/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personName: item.personName,
          targetType: item.targetType,
          targetName: item.targetName,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message || `Erro ${res.status}`);
      }
      const data = (await res.json()) as UndoResult;
      setUndoResult(data);
      await Promise.all([loadPersons(), loadHistory()]);
      if (selected === item.personName) {
        await loadDetail(item.personName);
      }
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : "Erro ao desfazer.");
    } finally {
      setUndoingKey(null);
    }
  }

  return (
    <div className="space-y-6">
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
      {/* People list */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-[var(--foreground-strong)]">
            Pessoas mapeadas
          </h2>
          <button
            aria-label="Atualizar lista"
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent)]"
            onClick={loadPersons}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </header>

        <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-[var(--muted)]" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar por nome"
            type="search"
            value={filter}
          />
        </div>

        <div className="mt-3 max-h-[640px] overflow-y-auto pr-1">
          {loadingList && (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando pessoas...
            </div>
          )}
          {listError && (
            <div className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <AlertCircle className="mt-0.5 h-4 w-4" /> {listError}
            </div>
          )}
          {!loadingList && !listError && filtered.length === 0 && (
            <p className="px-2 py-3 text-sm text-[var(--muted)]">
              Nenhuma pessoa encontrada no grafo.
            </p>
          )}
          <ul className="space-y-1">
            {filtered.map((p) => {
              const isActive = p.name === selected;
              return (
                <li key={p.name}>
                  <button
                    className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                      isActive
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-transparent hover:border-[var(--border)] hover:bg-white"
                    }`}
                    onClick={() => handleSelect(p.name)}
                    type="button"
                  >
                    <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black text-[var(--foreground-strong)]">
                        {p.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                        {p.documentCount} doc{p.documentCount !== 1 ? "s" : ""} ·{" "}
                        {p.chunkCount} trecho{p.chunkCount !== 1 ? "s" : ""}
                        {p.sectors.length > 0 && ` · ${p.sectors.join(", ")}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Detail */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        {!selected && (
          <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-2 text-center text-[var(--muted)]">
            <UserCog className="h-10 w-10 opacity-40" />
            <p className="text-sm">Selecione uma pessoa para ver as referências.</p>
          </div>
        )}

        {selected && loadingDetail && (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando referências...
          </div>
        )}

        {selected && detailError && (
          <div className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4" /> {detailError}
          </div>
        )}

        {selected && detail && !loadingDetail && (
          <>
            <header className="mb-4 border-b border-[var(--border)] pb-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
                Pessoa selecionada
              </p>
              <h2 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                {detail.name}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {detail.documents.length} documento
                {detail.documents.length !== 1 ? "s" : ""} referenciam essa pessoa.
              </p>
            </header>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
              {/* Documents */}
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-[0.18em] text-[var(--foreground-strong)]">
                  Documentos afetados
                </h3>
                {detail.documents.length === 0 && (
                  <p className="text-sm text-[var(--muted)]">
                    Nenhum documento vinculado a essa pessoa no grafo.
                  </p>
                )}
                {detail.documents.map((doc) => {
                  const picked = pickedDocs.has(doc.documentId);
                  return (
                    <article
                      className={`rounded-md border px-4 py-3 transition-colors ${
                        picked
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--border)] bg-white"
                      }`}
                      key={doc.documentId}
                    >
                      <div className="flex items-start gap-3">
                        <label className="flex min-w-0 flex-1 items-start gap-3">
                          <input
                            checked={picked}
                            className="mt-1 h-4 w-4 accent-[var(--accent)]"
                            onChange={() => togglePicked(doc.documentId)}
                            type="checkbox"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-black text-[var(--foreground-strong)]">
                              {doc.title}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                              Setor {doc.sector} · {doc.chunkCount} trecho
                              {doc.chunkCount !== 1 ? "s" : ""} com a referência
                            </span>
                          </span>
                        </label>
                        <button
                          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-2.5 py-1 text-[11px] font-black text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          onClick={() => setPreviewDoc(doc)}
                          type="button"
                        >
                          <FileText className="h-3.5 w-3.5" /> Ver documento
                        </button>
                      </div>
                      {doc.previewSnippets.length > 0 && (
                        <ul className="mt-3 space-y-2 border-l-2 border-[var(--border)] pl-3">
                          {doc.previewSnippets.map((snippet) => (
                            <li
                              className="text-[12px] leading-relaxed text-[var(--foreground-soft)]"
                              key={snippet.pointId}
                            >
                              <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                                {snippet.headingPath}
                              </span>
                              <span className="mt-0.5 block">
                                {highlightName(snippet.excerpt, detail.name)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </article>
                  );
                })}
              </div>

              {/* Action panel */}
              <aside className="sticky top-4 h-fit rounded-md border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                <h3 className="text-xs font-black uppercase tracking-[0.18em] text-[var(--foreground-strong)]">
                  Substituir por
                </h3>

                <label className="mt-3 block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Tipo de entidade
                </label>
                <select
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
                  onChange={(e) => {
                    setConfirming(false);
                    setTargetType(e.target.value as TargetType);
                  }}
                  value={targetType}
                >
                  {TARGET_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                  {TARGET_OPTIONS.find((o) => o.value === targetType)?.hint}
                </p>

                <label className="mt-3 block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Nome
                </label>
                <input
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
                  onChange={(e) => {
                    setConfirming(false);
                    setTargetName(e.target.value);
                  }}
                  placeholder={
                    targetType === "Person"
                      ? "Nome correto da pessoa"
                      : "Ex: SAP, LGPD, Pedido Eletronico"
                  }
                  type="text"
                  value={targetName}
                />

                <label className="mt-4 flex items-start gap-2 text-[12px] text-[var(--foreground-soft)]">
                  <input
                    checked={deleteOriginal}
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                    onChange={(e) => setDeleteOriginal(e.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Remover o nó da pessoa quando todas as referências forem
                    reclassificadas
                  </span>
                </label>

                {!confirming && (
                  <button
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-black text-white shadow-sm transition-opacity disabled:opacity-40"
                    disabled={
                      pickedDocs.size === 0 || targetName.trim().length === 0
                    }
                    onClick={requestConfirm}
                    type="button"
                  >
                    Revisar e aplicar
                  </button>
                )}

                {confirming && (
                  <div className="mt-4 rounded-md border-2 border-amber-300 bg-amber-50 p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-900">
                      Confirme a operacao
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-md bg-white px-2 py-1 font-black text-[var(--foreground-strong)] ring-1 ring-[var(--border)]">
                        {selected}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-amber-800">
                        Pessoa
                      </span>
                      <ArrowRight className="h-4 w-4 text-amber-700" />
                      <span className="rounded-md bg-white px-2 py-1 font-black text-[var(--foreground-strong)] ring-1 ring-[var(--border)]">
                        {targetName.trim()}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-amber-800">
                        {
                          TARGET_OPTIONS.find((o) => o.value === targetType)
                            ?.label
                        }
                      </span>
                    </div>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11px] text-amber-900">
                      <li>
                        {pickedDocs.size} documento
                        {pickedDocs.size !== 1 ? "s" : ""} serao afetados.
                      </li>
                      <li>
                        Texto dos trechos sera reescrito e o embedding sera
                        regenerado.
                      </li>
                      <li>
                        Arestas no grafo: Pessoa{" "}
                        <ArrowRight className="inline h-3 w-3" />{" "}
                        {targetType === "Person"
                          ? "outra Pessoa"
                          : TARGET_OPTIONS.find((o) => o.value === targetType)
                              ?.label}
                        .
                      </li>
                      {deleteOriginal && targetType !== "Person" && (
                        <li>
                          O no da pessoa {selected} sera removido se ficar sem
                          referencias.
                        </li>
                      )}
                    </ul>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="flex flex-1 items-center justify-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-black text-white shadow-sm transition-opacity disabled:opacity-40"
                        disabled={submitting}
                        onClick={handleSubmit}
                        type="button"
                      >
                        {submitting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />{" "}
                            Aplicando...
                          </>
                        ) : (
                          <>Confirmar e aplicar</>
                        )}
                      </button>
                      <button
                        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-100"
                        disabled={submitting}
                        onClick={cancelConfirm}
                        type="button"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                  O texto dos trechos será reescrito (substituindo o nome) e o
                  embedding será regenerado. O grafo trocará as arestas de
                  Pessoa para o novo tipo. A operacao pode ser desfeita pela
                  secao &quot;Reclassificacoes recentes&quot;.
                </p>

                {submitError && (
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    <AlertCircle className="mt-0.5 h-4 w-4" /> {submitError}
                  </div>
                )}

                {result && (
                  <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    <p className="flex items-center gap-1.5 font-black">
                      <CheckCircle2 className="h-4 w-4" /> Reclassificação aplicada
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {result.perDocument.map((row) => (
                        <li key={row.documentId}>
                          {row.error
                            ? `Falha em ${row.documentId.slice(0, 12)}...: ${row.error}`
                            : `${row.documentId.slice(0, 12)}...: ${row.chunksRewritten} trecho(s) reescritos, ${row.chunkEdges} aresta(s) trocadas`}
                        </li>
                      ))}
                    </ul>
                    {result.personDropped && (
                      <p className="mt-1 font-black">
                        Nó da pessoa removido (sem mais referências).
                      </p>
                    )}
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </section>
    </div>

    {/* History */}
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-[var(--foreground-strong)]">
            Reclassificacoes recentes
          </h2>
        </div>
        <button
          aria-label="Atualizar historico"
          className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent)]"
          onClick={loadHistory}
          type="button"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Cada item pode ser desfeito: a pessoa volta a aparecer na lista, o
        texto dos trechos retorna ao original e o embedding e regenerado.
      </p>

      {loadingHistory && (
        <div className="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando historico...
        </div>
      )}
      {historyError && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4" /> {historyError}
        </div>
      )}
      {!loadingHistory && !historyError && history.length === 0 && (
        <p className="mt-3 text-sm text-[var(--muted)]">
          Nenhuma reclassificacao registrada no audit do grafo.
        </p>
      )}

      {undoError && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4" /> {undoError}
        </div>
      )}
      {undoResult && (
        <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <p className="flex items-center gap-1.5 font-black">
            <CheckCircle2 className="h-4 w-4" /> Reclassificacao desfeita
          </p>
          <p className="mt-1">
            {undoResult.personName} restaurada em{" "}
            {undoResult.documentsAffected} documento
            {undoResult.documentsAffected !== 1 ? "s" : ""}. Arestas movidas:{" "}
            {undoResult.graph.documentEdges} doc /{" "}
            {undoResult.graph.chunkEdges} chunk.
            {undoResult.graph.targetDropped &&
              " No alvo removido por ficar orfao."}
          </p>
        </div>
      )}

      {history.length > 0 && (
        <ul className="mt-4 space-y-2">
          {history.map((item) => {
            const key = `${item.personName}|${item.targetType}|${item.targetName}`;
            const isUndoing = undoingKey === key;
            return (
              <li
                className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--border)] bg-white px-4 py-3"
                key={key}
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-md bg-[var(--surface-muted)] px-2 py-0.5 font-black text-[var(--foreground-strong)]">
                    {item.personName}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                    Pessoa
                  </span>
                  <ArrowRight className="h-4 w-4 text-[var(--muted)]" />
                  <span className="rounded-md bg-[var(--surface-muted)] px-2 py-0.5 font-black text-[var(--foreground-strong)]">
                    {item.targetName}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                    {TARGET_OPTIONS.find((o) => o.value === item.targetType)
                      ?.label ?? item.targetType}
                  </span>
                  <span className="text-[11px] text-[var(--muted)]">
                    · {item.documentCount} doc
                    {item.documentCount !== 1 ? "s" : ""}
                  </span>
                  {item.lastUpdatedAt && (
                    <span className="text-[11px] text-[var(--muted)]">
                      · {new Date(item.lastUpdatedAt).toLocaleString("pt-BR")}
                    </span>
                  )}
                </div>
                <button
                  className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-black text-[var(--foreground-strong)] transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-40"
                  disabled={isUndoing}
                  onClick={() => handleUndo(item)}
                  type="button"
                >
                  {isUndoing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
                      Desfazendo...
                    </>
                  ) : (
                    <>
                      <Undo2 className="h-3.5 w-3.5" /> Desfazer
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>

    {previewDoc && (
      <DocumentDetailModal
        documentId={previewDoc.sourceDocumentId}
        documentTitle={previewDoc.title}
        sector={previewDoc.sector}
        onClose={() => setPreviewDoc(null)}
      />
    )}
    </div>
  );
}

function highlightName(text: string, name: string) {
  if (!name) return text;
  const lower = text.toLowerCase();
  const needle = name.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  let idx = lower.indexOf(needle, cursor);
  while (idx >= 0) {
    if (idx > cursor) {
      parts.push({ text: text.slice(cursor, idx), match: false });
    }
    parts.push({ text: text.slice(idx, idx + needle.length), match: true });
    cursor = idx + needle.length;
    idx = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), match: false });
  }
  return parts.map((part, i) =>
    part.match ? (
      <mark
        className="rounded bg-amber-200 px-0.5 text-[var(--foreground-strong)]"
        key={i}
      >
        {part.text}
      </mark>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  );
}
