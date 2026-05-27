"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { InfoTooltip } from "@/components/info-tooltip";
import { MessageIngestionPanel } from "@/components/message-ingestion-panel";
import type { UserRole } from "@/lib/domain";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  type DocumentType,
} from "@/lib/document-types";
import { getSectorLabel } from "@/lib/labels";
import {
  ACCEPTED_UPLOAD_FORMATS,
  ACCEPTED_UPLOAD_MIME_TYPES,
  createUploadItems,
  summarizeUploadItems,
  type BaseUploadQueueItem,
  type UploadItemStatus,
} from "@/lib/upload";

type UploadResponse = {
  documentId: string;
  documentTitle: string;
  sector: string;
  status?: string;
  sopReadinessScore?: number;
  curationReadinessScore?: number;
  documentType?: DocumentType;
  classificationConfidence?: number;
  chunksCreated: number;
  fileName: string;
  relativePath?: string;
  alreadyIngested?: boolean;
  message?: string;
};

type UploadQueueItem = BaseUploadQueueItem & {
  result?: UploadResponse;
  classification?: {
    documentType: DocumentType;
    confidence: number;
    signals: string[];
    title?: string;
    topic?: string;
    isHybrid: boolean;
  };
  selectedDocumentType?: DocumentType;
  isClassifying?: boolean;
};

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

function getUploadStatusLabel(status: UploadItemStatus) {
  if (status === "pending") {
    return "Pendente";
  }

  if (status === "uploading") {
    return "Enviando";
  }

  if (status === "success") {
    return "Sucesso";
  }

  if (status === "already_ingested") {
    return "Ja indexado";
  }

  if (status === "ignored") {
    return "Ignorado";
  }

  return "Erro";
}

function getUploadStatusClassName(status: UploadItemStatus) {
  if (status === "success") {
    return "bg-emerald-400/15 text-emerald-700";
  }

  if (status === "already_ingested") {
    return "bg-amber-400/15 text-amber-700";
  }

  if (status === "uploading") {
    return "bg-[var(--accent-soft)] text-[var(--accent)]";
  }

  if (status === "ignored") {
    return "bg-slate-300/30 text-slate-700";
  }

  if (status === "error") {
    return "bg-red-500/15 text-red-700";
  }

  return "bg-[var(--surface-muted)] text-[var(--foreground-soft)]";
}

export function SectorIngestionWorkbench({
  sectorOptions,
  user,
}: {
  sectorOptions: SectorOption[];
  user: SessionUser;
}) {
  const normalizedSectorOptions =
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
  const [activeTab, setActiveTab] = useState<"files" | "messages">("files");
  const [selectedSector, setSelectedSector] = useState<string>(user.sector);
  const selectedSectorLabel =
    normalizedSectorOptions.find((sector) => sector.slug === selectedSector)
      ?.displayName ?? getSectorLabel(selectedSector);
  const userSectorLabel =
    normalizedSectorOptions.find((sector) => sector.slug === user.sector)
      ?.displayName ?? getSectorLabel(user.sector);
  const [uploadItems, setUploadItems] = useState<UploadQueueItem[]>([]);
  const [isUploadPending, setIsUploadPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }

    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  const uploadSummary = useMemo(
    () =>
      summarizeUploadItems(
        uploadItems.map((item) => ({
          status: item.status,
          result: item.result
            ? { chunksCreated: item.result.chunksCreated }
            : undefined,
        })),
      ),
    [uploadItems],
  );

  const hasEligibleUploadItems = uploadItems.some(
    (item) => item.status === "pending",
  );
  const progressPercent =
    uploadSummary.totalEligible > 0
      ? Math.round((uploadSummary.processed / uploadSummary.totalEligible) * 100)
      : 0;

  const classifyItem = async (item: UploadQueueItem) => {
    if (item.status === "ignored") {
      return;
    }

    const formData = new FormData();
    formData.append("file", item.file);
    if (item.relativePath) {
      formData.append("relativePath", item.relativePath);
    }

    const response = await fetch("/api/classify", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json()) as
      | (UploadQueueItem["classification"] & { message?: string })
      | { message?: string };

    if (!response.ok || !("documentType" in payload)) {
      throw new Error(payload.message ?? "Falha ao classificar o arquivo.");
    }

    return payload;
  };

  const handleSelection = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const nextItems = createUploadItems(Array.from(fileList)).map((item) => ({
      ...item,
      isClassifying: item.status !== "ignored",
    }));
    setUploadItems(nextItems);
    setActiveFileName(null);
    setErrorMessage("");

    void (async () => {
      for (const item of nextItems) {
        if (item.status === "ignored") {
          continue;
        }

        try {
          const classification = await classifyItem(item);
          setUploadItems((currentItems) =>
            currentItems.map((current) =>
              current.id === item.id
                ? {
                    ...current,
                    classification,
                    selectedDocumentType: classification?.documentType,
                    isClassifying: false,
                  }
                : current,
            ),
          );
        } catch (error) {
          setUploadItems((currentItems) =>
            currentItems.map((current) =>
              current.id === item.id
                ? {
                    ...current,
                    isClassifying: false,
                    error:
                      error instanceof Error
                        ? error.message
                        : "Falha ao classificar o arquivo.",
                  }
                : current,
            ),
          );
        }
      }
    })();
  };

  const handleUpload = () => {
    if (!hasEligibleUploadItems) {
      setErrorMessage(
        "Selecione ao menos um arquivo elegivel .md, .docx, .doc ou .pdf antes de iniciar a ingestao.",
      );
      return;
    }

    setIsUploadPending(true);
    setActiveFileName(null);
    setErrorMessage("");

    void (async () => {
      let nextItems = uploadItems.map((item) =>
        item.status === "pending"
          ? {
              ...item,
              error: undefined,
              result: undefined,
            }
          : item,
      );
      setUploadItems(nextItems);

      try {
        for (const item of nextItems) {
          if (item.status !== "pending") {
            continue;
          }

          setActiveFileName(item.displayPath);
          nextItems = nextItems.map((current) =>
            current.id === item.id
              ? { ...current, status: "uploading" as const, error: undefined }
              : current,
          );
          setUploadItems(nextItems);

          try {
            const formData = new FormData();
            formData.append("file", item.file);
            formData.append("sector", selectedSector);
            if (item.selectedDocumentType ?? item.classification?.documentType) {
              formData.append(
                "documentType",
                item.selectedDocumentType ?? item.classification?.documentType ?? "sop",
              );
            }
            if (typeof item.classification?.confidence === "number") {
              formData.append(
                "classificationConfidence",
                String(item.classification.confidence),
              );
            }
            if (item.relativePath) {
              formData.append("relativePath", item.relativePath);
            }

            const response = await fetch("/api/ingest", {
              method: "POST",
              body: formData,
            });
            const payload = (await response.json()) as UploadResponse & {
              message?: string;
            };

            if (!response.ok) {
              throw new Error(payload.message ?? "Falha ao ingerir o arquivo.");
            }

            nextItems = nextItems.map((current) =>
              current.id === item.id
                ? {
                    ...current,
                    status: payload.alreadyIngested
                      ? ("already_ingested" as const)
                      : ("success" as const),
                    result: payload,
                  }
                : current,
            );
            setUploadItems(nextItems);
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Falha ao ingerir o arquivo.";

            nextItems = nextItems.map((current) =>
              current.id === item.id
                ? {
                    ...current,
                    status: "error" as const,
                    error: message,
                  }
                : current,
            );
            setUploadItems(nextItems);
          }
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Falha ao processar o lote selecionado.",
        );
      } finally {
        setIsUploadPending(false);
        setActiveFileName(null);
      }
    })();
  };

  const tabs: Array<{ id: "files" | "messages"; label: string; hint: string }> = [
    {
      id: "files",
      label: "Arquivos",
      hint: ".md, .docx, .doc, .pdf — fluxo padrao de upload",
    },
    {
      id: "messages",
      label: "Mensagens",
      hint: "Cole conversas de Teams ou WhatsApp",
    },
  ];

  return (
    <div className="space-y-6">
      <nav className="premium-panel flex flex-wrap gap-2 rounded-[2rem] p-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`flex-1 min-w-[200px] rounded-[1.5rem] px-5 py-3 text-left transition-colors ${
                isActive
                  ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                  : "text-[var(--foreground-soft)] hover:bg-white/70 hover:text-[var(--foreground-strong)]"
              }`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <span className="block text-[11px] font-bold uppercase tracking-[0.24em]">
                {tab.label}
              </span>
              <span className="mt-1 block text-xs">{tab.hint}</span>
            </button>
          );
        })}
      </nav>

      {activeTab === "messages" ? (
        <MessageIngestionPanel sectorOptions={normalizedSectorOptions} user={user} />
      ) : (
    <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <section className="space-y-6">
        <div className="premium-panel rounded-[2rem] p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Destino
          </p>
          <h3 className="mt-2 text-xl font-black text-[var(--foreground-strong)]">
            Setor de ingestão
          </h3>
          <p className="mt-3 text-sm leading-6 text-[var(--foreground-soft)]">
            Os arquivos deste lote entram na fila de revisao do setor
            selecionado antes de serem publicados para o chat.
          </p>

          {user.role === "admin" ? (
            <div className="mt-5 rounded-3xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-5">
              <label
                className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]"
                htmlFor="sector-select"
              >
                Setor de destino
              </label>
              <select
                className="mt-3 w-full rounded-2xl border border-[var(--border)] bg-white p-3 text-sm font-bold text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                disabled={isUploadPending}
                id="sector-select"
                onChange={(e) => {
                  setSelectedSector(e.target.value);
                  setUploadItems([]);
                  setErrorMessage("");
                  setActiveFileName(null);
                }}
                value={selectedSector}
              >
                {normalizedSectorOptions.map((sector) => (
                  <option key={sector.slug} value={sector.slug}>
                    {sector.displayName} / {sector.agentName}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-[var(--accent)]">
                Admin: voce pode enviar arquivos para qualquer setor. Ao trocar de setor a fila e resetada.
              </p>
            </div>
          ) : (
            <div className="mt-5 rounded-3xl border border-[var(--border)] bg-white/85 p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
                Setor autenticado
              </p>
              <p className="mt-2 text-lg font-black text-[var(--foreground-strong)]">
                {userSectorLabel}
              </p>
              <p className="mt-2 text-sm text-[var(--foreground-soft)]">
                Usuário: {user.name}
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)]">
              Selecionar arquivos
              <input
                accept={`${ACCEPTED_UPLOAD_FORMATS},${ACCEPTED_UPLOAD_MIME_TYPES}`}
                className="hidden"
                multiple
                onChange={(event) => {
                  handleSelection(event.target.files);
                  event.target.value = "";
                }}
                type="file"
              />
            </label>

            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)]">
              Selecionar pasta
              <input
                accept={`${ACCEPTED_UPLOAD_FORMATS},${ACCEPTED_UPLOAD_MIME_TYPES}`}
                className="hidden"
                multiple
                onChange={(event) => {
                  handleSelection(event.target.files);
                  event.target.value = "";
                }}
                ref={folderInputRef}
                type="file"
              />
            </label>
          </div>

          <p className="mt-4 text-sm leading-6 text-[var(--foreground-soft)]">
            A selecao de pasta inclui arquivos elegiveis das subpastas e preserva o
            caminho relativo de cada item para rastreabilidade.
          </p>

          <button
            className="mt-6 flex w-full items-center justify-center rounded-2xl bg-[var(--accent)] px-6 py-4 text-sm font-extrabold text-white transition-all hover:bg-[var(--accent-strong)] disabled:opacity-50"
            disabled={isUploadPending || !hasEligibleUploadItems}
            onClick={handleUpload}
            type="button"
          >
            {isUploadPending ? "Enviando lote..." : "Enviar lote para curadoria"}
          </button>

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="premium-panel rounded-[2rem] p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Resumo da fila
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                Selecionados
              </p>
              <p className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
                {uploadSummary.totalSelected}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                Elegiveis
              </p>
              <p className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
                {uploadSummary.totalEligible}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                Processados
              </p>
              <p className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
                {uploadSummary.processed}/{uploadSummary.totalEligible}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                <span className="inline-flex items-center">
                  Trechos indexados
                  <InfoTooltip text="Pedacos do documento que o chat consegue buscar para montar respostas." />
                </span>
              </p>
              <p className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
                {uploadSummary.totalChunksCreated}
              </p>
            </div>
          </div>

          <div className="mt-5 h-3 overflow-hidden rounded-full bg-[var(--surface-muted)]">
            <div
              className="h-full bg-[var(--accent)] transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--foreground-soft)]">
            <span>Sucesso: {uploadSummary.succeeded}</span>
            <span>Ja indexados: {uploadSummary.alreadyIngested}</span>
            <span>Falhas: {uploadSummary.failed}</span>
            <span>Ignorados: {uploadSummary.ignored}</span>
          </div>

          <p className="mt-4 text-sm text-[var(--foreground-soft)]">
            {activeFileName
              ? `Processando agora: ${activeFileName}`
              : uploadSummary.totalSelected > 0
                ? "Fila pronta para envio."
                : "Nenhum arquivo selecionado."}
          </p>
        </div>
      </section>

      <section className="premium-panel rounded-[2rem] p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Itens do lote
            </p>
            <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
              Status progressivo por arquivo
            </h3>
          </div>
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            {selectedSectorLabel}
          </span>
        </div>

        {uploadItems.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--foreground-soft)]">
            Selecione varios arquivos ou uma pasta inteira para montar a fila de ingestao.
          </div>
        ) : (
          <div className="mt-6 max-h-[720px] space-y-3 overflow-y-auto pr-2">
            {uploadItems.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--foreground-strong)]">
                      {item.displayPath}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {item.file.name} | {(item.file.size / 1024).toFixed(1)} KB
                    </p>
                    {item.relativePath ? (
                      <p className="mt-2 text-xs text-[var(--foreground-soft)]">
                        Caminho relativo: {item.relativePath}
                      </p>
                    ) : null}
                    {item.result?.documentTitle ? (
                      <p className="mt-2 text-xs text-[var(--foreground-soft)]">
                        Titulo detectado: {item.result.documentTitle}
                      </p>
                    ) : null}
                    {item.status !== "ignored" ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center">
                        <label
                          className="flex items-center text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]"
                          htmlFor={`document-type-${item.id}`}
                        >
                          Tipo documental
                          <InfoTooltip text="Classificacao do arquivo, como procedimento operacional, documento de processo, ata ou comunicado." />
                        </label>
                        <select
                          className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                          disabled={isUploadPending || item.status !== "pending"}
                          id={`document-type-${item.id}`}
                          onChange={(event) => {
                            const nextType = event.target.value as DocumentType;
                            setUploadItems((currentItems) =>
                              currentItems.map((current) =>
                                current.id === item.id
                                  ? {
                                      ...current,
                                      selectedDocumentType: nextType,
                                    }
                                  : current,
                              ),
                            );
                          }}
                          value={
                            item.selectedDocumentType ??
                            item.classification?.documentType ??
                            "sop"
                          }
                        >
                          {DOCUMENT_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {DOCUMENT_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {item.isClassifying ? (
                      <p className="mt-2 text-xs text-[var(--foreground-soft)]">
                        Classificando tipo documental...
                      </p>
                    ) : item.classification ? (
                      <p className="mt-2 text-xs text-[var(--foreground-soft)]">
                        Achamos que este e um{" "}
                        <strong>{DOCUMENT_TYPE_LABELS[item.classification.documentType]}</strong>{" "}
                        ({Math.round(item.classification.confidence * 100)}% de certeza).
                        Voce pode mudar.
                        {item.classification.isHybrid ? " | possivel hibrido" : ""}
                      </p>
                    ) : null}
                    {item.classification?.signals.length ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Sinais: {item.classification.signals.join(", ")}
                      </p>
                    ) : null}
                    {item.error ? (
                      <p className="mt-2 text-xs text-[var(--danger)]">
                        {item.error}
                      </p>
                    ) : null}
                    {!item.error && item.result?.message ? (
                      <p className="mt-2 text-xs text-[var(--foreground-soft)]">
                        {item.result.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <span
                      className={`inline-flex items-center rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${getUploadStatusClassName(item.status)}`}
                    >
                      {getUploadStatusLabel(item.status)}
                    </span>
                    {item.result ? (
                      <p className="text-xs font-semibold text-[var(--foreground-soft)]">
                        {item.result.chunksCreated} trecho(s) indexado(s)
                      </p>
                    ) : null}
                    {item.result?.status ? (
                      <p className="text-xs font-semibold text-[var(--foreground-soft)]">
                        {item.result.status}
                        {item.result.documentType
                          ? ` | ${DOCUMENT_TYPE_LABELS[item.result.documentType]}`
                          : ""}
                        {typeof (
                          item.result.curationReadinessScore ??
                          item.result.sopReadinessScore
                        ) === "number"
                          ? ` | prontidao para virar procedimento ${Math.round(
                              (item.result.curationReadinessScore ??
                                item.result.sopReadinessScore ??
                                0) * 100,
                            )}%`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
      )}
    </div>
  );
}
