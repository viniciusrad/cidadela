"use client";

import { useMemo, useState, type ClipboardEvent } from "react";

import type { UserRole } from "@/lib/domain";
import { getSectorLabel } from "@/lib/labels";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  sector: string;
  role: UserRole;
};

type SectorOption = {
  slug: string;
  displayName: string;
  agentName: string;
  isNative: boolean;
};

type MessageOrigin = "teams" | "whatsapp" | "other";

type EntityDomain = "concept" | "procedure" | "system" | "regulation";

type EntityFinding = {
  name: string;
  domain: EntityDomain;
  existsInGraph: boolean;
  docCount: number;
  sectors: string[];
};

type AnalysisResponse = {
  origin: MessageOrigin;
  sector: string;
  sectorLabel: string;
  suggestedTitle: string;
  fileName: string;
  lineCount: number;
  peopleMentioned: string[];
  peopleMentionedCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  payloadsDropped: number;
  payloadLinesDropped: number;
  format: "structured" | "freeform";
  distilledMarkdown: string;
  knowledgeItemCount: number;
  imageCount?: number;
  knowledge: {
    summary: string;
    decisions: Array<{ text: string; rationale?: string | null }>;
    procedures: Array<{ name: string; steps?: string[]; context?: string | null }>;
    systems: Array<{ name: string; usage?: string | null }>;
    rules: Array<{ text: string; scope?: string | null }>;
    concepts: Array<{ name: string; definition?: string | null }>;
    pendings: Array<{ text: string; owner?: string | null }>;
  };
  analysis: {
    graphAvailable: boolean;
    entities: {
      concepts: EntityFinding[];
      procedures: EntityFinding[];
      systems: EntityFinding[];
      regulations: EntityFinding[];
    };
    totals: { extracted: number; existing: number; novel: number };
  };
  submittedBy: {
    id: string;
    name: string;
    email: string;
  };
};

type IngestResponse = {
  documentId?: string;
  documentTitle?: string;
  sector?: string;
  status?: string;
  message?: string;
};

const ORIGIN_LABELS: Record<MessageOrigin, string> = {
  teams: "Microsoft Teams",
  whatsapp: "WhatsApp",
  other: "Outra origem",
};

const DOMAIN_TITLE: Record<EntityDomain, string> = {
  concept: "Conceitos",
  procedure: "Procedimentos",
  system: "Sistemas",
  regulation: "Normas",
};

const DOMAIN_HINT: Record<EntityDomain, string> = {
  concept: "Termos e ideias-chave que aparecem na conversa",
  procedure: "Passos e processos descritos pelas pessoas",
  system: "Ferramentas, plataformas e sistemas citados",
  regulation: "Politicas, normas e regulamentacoes mencionadas",
};

function EntityChip({ finding }: { finding: EntityFinding }) {
  const sectorHint =
    finding.existsInGraph && finding.sectors.length > 0
      ? `Tambem aparece em: ${finding.sectors.map((slug) => getSectorLabel(slug)).join(", ")}`
      : finding.existsInGraph
        ? "Ja existe no mapa de conhecimento"
        : "Novo no mapa";

  return (
    <span
      title={sectorHint}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        finding.existsInGraph
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-blue-300 bg-blue-50 text-blue-800"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          finding.existsInGraph ? "bg-emerald-500" : "bg-blue-500"
        }`}
      />
      {finding.name}
      {finding.existsInGraph && finding.docCount > 0 ? (
        <span className="rounded-full bg-emerald-200/70 px-1.5 text-[9px] font-bold tabular-nums text-emerald-900">
          {finding.docCount}
        </span>
      ) : null}
    </span>
  );
}

function DomainBlock({
  domain,
  findings,
}: {
  domain: EntityDomain;
  findings: EntityFinding[];
}) {
  if (findings.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white/80 p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
        {DOMAIN_TITLE[domain]}
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--foreground-soft)]">
        {DOMAIN_HINT[domain]}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {findings.map((finding) => (
          <EntityChip key={`${domain}-${finding.name}`} finding={finding} />
        ))}
      </div>
    </div>
  );
}

export function MessageIngestionPanel({
  sectorOptions,
  user,
}: {
  sectorOptions: SectorOption[];
  user: SessionUser;
}) {
  const normalizedSectorOptions: SectorOption[] =
    sectorOptions.length > 0
      ? sectorOptions
      : [
          {
            slug: user.sector,
            displayName: getSectorLabel(user.sector),
            agentName: getSectorLabel(user.sector),
            isNative: true,
          },
        ];

  const [origin, setOrigin] = useState<MessageOrigin>("teams");
  const [sector, setSector] = useState<string>(user.sector);
  const [text, setText] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [images, setImages] = useState<Array<{ id: string; dataUrl: string; name: string }>>([]);
  const [editedDistilledMarkdown, setEditedDistilledMarkdown] = useState<string>("");
  const [isDistilledDirty, setIsDistilledDirty] = useState(false);
  const [prevAnalysis, setPrevAnalysis] = useState<AnalysisResponse | null>(null);

  if (analysis !== prevAnalysis) {
    setPrevAnalysis(analysis);
    setEditedDistilledMarkdown(analysis?.distilledMarkdown ?? "");
    setIsDistilledDirty(false);
  }

  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Falha ao ler imagem do clipboard."));
      reader.readAsDataURL(file);
    });
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItems = items.filter(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
    if (imageItems.length === 0) return;
    event.preventDefault();

    const slotsLeft = MAX_IMAGES - images.length;
    if (slotsLeft <= 0) {
      setErrorMessage(`Maximo de ${MAX_IMAGES} imagens por conversa.`);
      return;
    }

    const accepted: Array<{ id: string; dataUrl: string; name: string }> = [];
    for (const item of imageItems.slice(0, slotsLeft)) {
      const file = item.getAsFile();
      if (!file) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        setErrorMessage(`Imagem maior que ${MAX_IMAGE_BYTES / (1024 * 1024)} MB ignorada.`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          dataUrl,
          name: file.name || `imagem-${images.length + accepted.length + 1}.png`,
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao anexar imagem.");
      }
    }

    if (accepted.length > 0) {
      setImages((prev) => [...prev, ...accepted]);
      if (analysis) resetAnalysis();
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id));
    if (analysis) resetAnalysis();
  }

  const isAdmin = user.role === "admin";
  const canAnalyze = text.trim().length >= 10 && !isAnalyzing;
  const canIngest = analysis !== null && !isIngesting && Boolean(sector);

  const sectorLabel = useMemo(
    () =>
      normalizedSectorOptions.find((option) => option.slug === sector)?.displayName ??
      getSectorLabel(sector),
    [normalizedSectorOptions, sector],
  );

  function resetAnalysis() {
    setAnalysis(null);
    setTitle("");
    setSuccessMessage("");
  }

  async function handleAnalyze() {
    setErrorMessage("");
    setSuccessMessage("");
    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/messages/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          origin,
          sector,
          images: images.map((img) => img.dataUrl),
        }),
      });
      const data = (await response.json()) as
        | AnalysisResponse
        | { message: string };
      if (!response.ok || "message" in data) {
        throw new Error(
          "message" in data ? data.message : "Falha ao analisar a conversa.",
        );
      }
      setAnalysis(data);
      setTitle(data.suggestedTitle);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao analisar a conversa.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleIngest() {
    if (!analysis) return;
    setErrorMessage("");
    setSuccessMessage("");
    setIsIngesting(true);
    try {
      const response = await fetch("/api/messages/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          origin,
          sector,
          title: title.trim() || analysis.suggestedTitle,
          distilledMarkdown:
            editedDistilledMarkdown.trim() || analysis.distilledMarkdown,
        }),
      });
      const data = (await response.json()) as IngestResponse & {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message ?? "Falha ao enviar para curadoria.");
      }
      setSuccessMessage(
        `Conversa enviada para curadoria do setor ${getSectorLabel(
          data.sector ?? sector,
        )}. Titulo: "${data.documentTitle ?? title}".`,
      );
      setText("");
      setAnalysis(null);
      setTitle("");
      setImages([]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao enviar a conversa.",
      );
    } finally {
      setIsIngesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="premium-panel rounded-[2rem] p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Importar conversa
          </p>
          <h2 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
            Cole mensagens de Teams ou WhatsApp
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
            Conhecimento valioso muitas vezes vive em mensagens. Cole o trecho
            relevante, escolha a origem e o setor — vamos analisar com quais
            assuntos a conversa se relaciona antes de enviar para curadoria.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]"
                htmlFor="message-origin"
              >
                Origem
              </label>
              <select
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                id="message-origin"
                onChange={(event) => {
                  setOrigin(event.target.value as MessageOrigin);
                  resetAnalysis();
                }}
                value={origin}
              >
                <option value="teams">Microsoft Teams</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="other">Outra origem</option>
              </select>
            </div>

            <div>
              <label
                className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]"
                htmlFor="message-sector"
              >
                Setor de destino
              </label>
              {isAdmin ? (
                <select
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                  id="message-sector"
                  onChange={(event) => setSector(event.target.value)}
                  value={sector}
                >
                  {normalizedSectorOptions.map((option) => (
                    <option key={option.slug} value={option.slug}>
                      {option.displayName} / {option.agentName}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm font-semibold text-[var(--foreground-strong)]">
                  {sectorLabel}
                </p>
              )}
            </div>
          </div>

          <div className="mt-5">
            <label
              className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]"
              htmlFor="message-text"
            >
              Texto da conversa
            </label>
            <textarea
              className="mt-2 h-72 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm leading-6 text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
              id="message-text"
              onChange={(event) => {
                setText(event.target.value);
                if (analysis) resetAnalysis();
              }}
              onPaste={handlePaste}
              placeholder={`Cole as mensagens como vieram do Teams ou WhatsApp.\n\nVoce tambem pode colar prints (Ctrl+V) — o modelo de visao transcreve o\nconteudo da imagem (texto de tela, sistemas, status) e injeta como contexto\nantes da destilacao.\n\nO texto bruto e preservado verbatim; payloads JSON sao descartados.`}
              value={text}
            />
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Maximo de 200 mil caracteres e {MAX_IMAGES} imagens
              ({(MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0)} MB cada). Datas, nomes proprios e conteudo
              de prints colados sao detectados para guiar a analise.
            </p>

            {images.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-3">
                {images.map((img, idx) => (
                  <div
                    className="group relative h-20 w-20 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-soft)]"
                    key={img.id}
                    title={img.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={`Print colado ${idx + 1}`}
                      className="h-full w-full object-cover"
                      src={img.dataUrl}
                    />
                    <button
                      aria-label={`Remover imagem ${idx + 1}`}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => removeImage(img.id)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="flex items-center justify-center rounded-2xl bg-[var(--accent)] px-6 py-3 text-sm font-extrabold text-white transition-all hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canAnalyze}
              onClick={handleAnalyze}
              type="button"
            >
              {isAnalyzing ? "Analisando..." : "Analisar conversa"}
            </button>
            {analysis ? (
              <button
                className="rounded-2xl border border-[var(--border)] bg-white px-6 py-3 text-sm font-bold text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)]"
                onClick={resetAnalysis}
                type="button"
              >
                Refazer analise
              </button>
            ) : null}
          </div>

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
              {errorMessage}
            </div>
          ) : null}
          {successMessage ? (
            <div className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {successMessage}
            </div>
          ) : null}
        </div>

        <div className="premium-panel rounded-[2rem] p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Como esta conversa sera tratada
          </p>
          <h3 className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
            Resumo de preparacao
          </h3>

          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[var(--muted)]">Origem</dt>
              <dd className="font-bold text-[var(--foreground-strong)]">
                {ORIGIN_LABELS[origin]}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[var(--muted)]">Setor</dt>
              <dd className="font-bold text-[var(--foreground-strong)]">
                {sectorLabel}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[var(--muted)]">Autor da importacao</dt>
              <dd className="text-right font-bold text-[var(--foreground-strong)]">
                {user.name}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[var(--muted)]">Itens destilados</dt>
              <dd className="font-bold text-[var(--foreground-strong)]">
                {analysis ? analysis.knowledgeItemCount : "—"}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[var(--muted)]">Imagens transcritas</dt>
              <dd className="font-bold text-[var(--foreground-strong)]">
                {images.length > 0
                  ? `${images.length}${
                      analysis && typeof analysis.imageCount === "number"
                        ? ` (analisada${analysis.imageCount === 1 ? "" : "s"})`
                        : " (pendente)"
                    }`
                  : "—"}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[var(--muted)]">Pessoas mencionadas</dt>
              <dd className="text-right font-bold text-[var(--foreground-strong)]">
                {analysis
                  ? analysis.peopleMentionedCount === 0
                    ? "—"
                    : `${analysis.peopleMentionedCount} (${analysis.peopleMentioned
                        .slice(0, 3)
                        .join(", ")}${analysis.peopleMentioned.length > 3 ? "..." : ""})`
                  : "—"}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[var(--muted)]">Periodo</dt>
              <dd className="font-bold text-[var(--foreground-strong)]">
                {analysis && analysis.dateFrom && analysis.dateTo
                  ? analysis.dateFrom === analysis.dateTo
                    ? analysis.dateFrom
                    : `${analysis.dateFrom} a ${analysis.dateTo}`
                  : "—"}
              </dd>
            </div>
            {analysis && analysis.payloadsDropped > 0 ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                {analysis.payloadsDropped} bloco(s) JSON/payload tecnico
                ({analysis.payloadLinesDropped} linhas) foram descartados — o
                objetivo e extrair conhecimento textual util, nao reproduzir
                dados tecnicos.
              </div>
            ) : null}
            {analysis ? (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-[11px] leading-relaxed text-[var(--foreground-soft)]">
                A conversa nao e armazenada na integra. O modelo destila apenas
                decisoes, procedimentos, sistemas, regras, conceitos e
                pendencias relevantes — o texto bruto e descartado para manter
                o banco enxuto. O autor registrado sera{" "}
                <strong>{user.name}</strong> (voce).
              </p>
            ) : null}
          </dl>
        </div>
      </section>

      {analysis ? (
        <section className="premium-panel space-y-5 rounded-[2rem] p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Domínios identificados
              </p>
              <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                Com o que essa conversa se relaciona
              </h3>
              <p className="mt-1 text-sm text-[var(--foreground-soft)]">
                {analysis.analysis.totals.extracted === 0
                  ? "Nao identificamos conceitos, procedimentos ou sistemas nesta conversa. Voce ainda pode envia-la para curadoria — o conteudo bruto sera preservado."
                  : analysis.analysis.graphAvailable
                    ? `${analysis.analysis.totals.existing} ja conhecido(s) no mapa, ${analysis.analysis.totals.novel} novo(s).`
                    : `${analysis.analysis.totals.extracted} encontrado(s). Mapa de conhecimento indisponivel para checar coincidencias agora.`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 text-[11px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Verde: ja no mapa
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                Azul: novo
              </span>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <DomainBlock domain="concept" findings={analysis.analysis.entities.concepts} />
            <DomainBlock domain="procedure" findings={analysis.analysis.entities.procedures} />
            <DomainBlock domain="system" findings={analysis.analysis.entities.systems} />
            <DomainBlock domain="regulation" findings={analysis.analysis.entities.regulations} />
          </div>

          <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <label
                className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]"
                htmlFor="message-title"
              >
                Titulo (editavel)
              </label>
              <input
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)]"
                id="message-title"
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                Como esta conversa aparecera para o curador.
              </p>
            </div>
            <div className="flex flex-col justify-end gap-2">
              <button
                className="rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-extrabold text-white transition-all hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canIngest}
                onClick={handleIngest}
                type="button"
              >
                {isIngesting ? "Enviando..." : "Enviar para curadoria"}
              </button>
              <p className="text-[11px] text-[var(--muted)]">
                Vai para a fila de revisao do setor — nada entra no chat sem
                aprovacao.
              </p>
            </div>
          </div>

          <details className="rounded-2xl border border-[var(--border)] bg-white/60 p-4" open>
            <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
              Conhecimento destilado (editavel — sera armazenado)
            </summary>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-[var(--muted)]">
                Apenas este markdown destilado entra no banco. O texto bruto da
                conversa nao e preservado. Edite livremente antes de enviar
                para curadoria.
              </p>
              {isDistilledDirty ? (
                <button
                  className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-[11px] font-bold text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  onClick={() => {
                    setEditedDistilledMarkdown(analysis.distilledMarkdown);
                    setIsDistilledDirty(false);
                  }}
                  type="button"
                >
                  Restaurar original
                </button>
              ) : null}
            </div>
            <textarea
              aria-label="Conhecimento destilado editavel"
              className="mt-3 max-h-[28rem] min-h-[18rem] w-full overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 font-mono text-[11px] leading-relaxed text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)] focus:bg-white"
              disabled={isIngesting}
              onChange={(event) => {
                setEditedDistilledMarkdown(event.target.value);
                setIsDistilledDirty(
                  event.target.value !== analysis.distilledMarkdown,
                );
              }}
              spellCheck={false}
              value={editedDistilledMarkdown}
            />
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {isDistilledDirty
                ? "Voce editou o conteudo destilado — a versao acima sera enviada."
                : "Sem edicoes. O markdown sugerido pelo modelo sera enviado como esta."}
            </p>
          </details>
        </section>
      ) : null}
    </div>
  );
}
