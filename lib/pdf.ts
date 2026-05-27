import { resolve } from "node:path";
import { Worker as NodeWorker } from "node:worker_threads";
import { pathToFileURL } from "node:url";

import { PDFParse } from "pdf-parse";
import { PDFWorker } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { DocumentSourceOrigin } from "@/lib/markdown";
import {
  buildFrontmatterRecord,
  countWords,
  extractHeadings,
  normalizeMarkdownBody,
  normalizeWhitespace,
  type ConvertedDocument,
} from "@/lib/document-shared";

type WorkerLikeMessageEvent = {
  data: unknown;
};

class NodeWorkerPort {
  constructor(private readonly worker: NodeWorker) {}

  postMessage(message: unknown, transfer?: readonly unknown[]) {
    this.worker.postMessage(message, (transfer ?? []) as never);
  }

  addEventListener(
    type: string,
    listener: (event: WorkerLikeMessageEvent) => void,
    options?: { signal?: AbortSignal },
  ) {
    if (type !== "message") {
      return;
    }

    const wrappedListener = (data: unknown) => {
      listener({ data });
    };

    this.worker.on("message", wrappedListener);
    options?.signal?.addEventListener(
      "abort",
      () => {
        this.worker.off("message", wrappedListener);
      },
      { once: true },
    );
  }
}

type ManagedPdfWorker = {
  pdfWorker: PDFWorker;
  terminate: () => Promise<number>;
};

function createManagedPdfWorker(): ManagedPdfWorker | null {
  if (typeof PDFParse.setWorker !== "function") {
    return null;
  }

  const bridgePath = resolve(process.cwd(), "lib", "pdf.worker.bridge.mjs");
  const workerThread = new NodeWorker(pathToFileURL(bridgePath));
  const workerPort = new NodeWorkerPort(workerThread);
  const pdfWorker = new PDFWorker({
    port: workerPort as never,
  });

  return {
    pdfWorker,
    terminate: () => workerThread.terminate(),
  };
}

type ConvertPdfInput = {
  fileName: string;
  buffer: Buffer;
  sourceOrigin: DocumentSourceOrigin;
};

const MIN_EXTRACTED_TEXT_LENGTH = 20;

function sanitizeTitle(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const withoutWordPrefix = trimmed.replace(/^Microsoft Word\s*-\s*/i, "").trim();
  return withoutWordPrefix || trimmed;
}

const GENERIC_TITLES = [
  "sobre",
  "introducao",
  "objetivo",
  "resumo",
  "contexto",
  "historico",
  "finalidade",
];

function deriveTitle(fileName: string, rawTitle: unknown, bodyText: string) {
  const metadataTitle = sanitizeTitle(rawTitle);
  if (metadataTitle) {
    const cleanMetadata = metadataTitle.replace(/\*/g, "").toLowerCase();
    const isGeneric = GENERIC_TITLES.some(
      (generic) =>
        cleanMetadata === generic || cleanMetadata.startsWith(`${generic} `)
    );
    if (!isGeneric && metadataTitle.length > 3) {
      return metadataTitle.slice(0, 120);
    }
  }

  const lines = bodyText.split("\n").map((line) => line.trim());

  for (const line of lines) {
    if (!line) continue;
    const cleanLine = line.replace(/\*/g, "").toLowerCase();
    const isGeneric = GENERIC_TITLES.some(
      (generic) => cleanLine === generic || cleanLine.startsWith(`${generic} `)
    );

    if (!isGeneric && line.length > 3) {
      return line.slice(0, 120);
    }
  }

  return fileName.replace(/\.pdf$/i, "").trim() || "Documento";
}

export async function convertPdfToMarkdown({
  fileName,
  buffer,
  sourceOrigin,
}: ConvertPdfInput): Promise<ConvertedDocument> {
  const data = new Uint8Array(buffer);
  const managedWorker = createManagedPdfWorker();
  const parser = new PDFParse({
    data,
    ...(managedWorker ? { worker: managedWorker.pdfWorker } : {}),
  });

  let textResult;
  let infoResult;
  try {
    textResult = await parser.getText({ pageJoiner: "" });
    infoResult = await parser.getInfo();
  } catch (error) {
    await parser.destroy().catch(() => undefined);
    await managedWorker?.terminate().catch(() => undefined);
    const message = error instanceof Error ? error.message : "erro desconhecido";
    throw new Error(
      `Nao foi possivel ler o PDF enviado (${message}). Verifique se o arquivo esta intacto, ` +
        "nao esta protegido por senha e foi exportado como PDF padrao.",
    );
  }

  await parser.destroy().catch(() => undefined);
  await managedWorker?.terminate().catch(() => undefined);

  const conversionWarnings: string[] = [];
  const pageSections: string[] = [];
  let nonEmptyPages = 0;

  for (const page of textResult.pages) {
    const pageText = normalizeWhitespace(page.text ?? "").trim();

    if (!pageText) {
      conversionWarnings.push(
        `Pagina ${page.num} nao continha texto extraivel e foi ignorada.`,
      );
      continue;
    }

    nonEmptyPages += 1;
    pageSections.push(`## Pagina ${page.num}\n\n${pageText}`);
  }

  const aggregatedBody = pageSections.join("\n\n");
  const trimmedBody = aggregatedBody.trim();

  if (trimmedBody.length < MIN_EXTRACTED_TEXT_LENGTH) {
    throw new Error(
      "O PDF enviado nao contem texto selecionavel (provavelmente escaneado). " +
        "Envie um PDF com texto ou converta o arquivo via OCR antes de reenviar.",
    );
  }

  if (infoResult.info?.IsAcroFormPresent) {
    conversionWarnings.push(
      "O PDF contem um formulario Acro; campos de preenchimento podem nao aparecer no texto extraido.",
    );
  }

  if (nonEmptyPages < textResult.total) {
    conversionWarnings.push(
      `Somente ${nonEmptyPages} de ${textResult.total} paginas geraram texto.`,
    );
  }

  const markdownBody = normalizeMarkdownBody(aggregatedBody);
  const headings = extractHeadings(markdownBody);
  const title = deriveTitle(fileName, infoResult.info?.Title, markdownBody);
  const convertedAt = new Date().toISOString();
  const wordCount = countWords(markdownBody);

  const frontmatter = buildFrontmatterRecord({
    title,
    source_name: fileName,
    source_format: "pdf",
    source_origin: sourceOrigin,
    converted_at: convertedAt,
    word_count: wordCount,
    page_count: textResult.total,
    headings,
  });

  const markdown = `# ${title}\n\n${markdownBody}`.trim();

  return {
    markdown,
    title,
    headings,
    wordCount,
    conversionWarnings,
    convertedAt,
    frontmatter,
  };
}
