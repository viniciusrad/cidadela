const FILE_WITH_RELATIVE_PATH = Symbol("file-with-relative-path");

export const ACCEPTED_UPLOAD_FORMATS = ".md,.docx,.doc,.pdf";
export const ACCEPTED_UPLOAD_MIME_TYPES = [
  "text/markdown",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/pdf",
].join(",");
export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

export type UploadItemStatus =
  | "pending"
  | "uploading"
  | "success"
  | "already_ingested"
  | "error"
  | "ignored";

export type BaseUploadQueueItem = {
  id: string;
  file: File;
  displayPath: string;
  relativePath?: string;
  status: UploadItemStatus;
  error?: string;
};

export type UploadBatchSummary = {
  totalSelected: number;
  totalEligible: number;
  processed: number;
  succeeded: number;
  alreadyIngested: number;
  failed: number;
  ignored: number;
  totalChunksCreated: number;
};

export function isUploadFileEntry(
  value: FormDataEntryValue | null,
): value is File {
  return !!value && typeof value !== "string" && "name" in value && "size" in value;
}

export function getUploadFileExtension(fileName: string) {
  const normalizedName = fileName.trim().toLowerCase();

  if (normalizedName.endsWith(".docx")) {
    return ".docx";
  }

  if (normalizedName.endsWith(".doc")) {
    return ".doc";
  }

  if (normalizedName.endsWith(".md")) {
    return ".md";
  }

  if (normalizedName.endsWith(".pdf")) {
    return ".pdf";
  }

  return "";
}

export function getRelativePath(file: File) {
  const withRelativePath = file as File & {
    webkitRelativePath?: string;
    [FILE_WITH_RELATIVE_PATH]?: string;
  };
  const rawRelativePath =
    withRelativePath.webkitRelativePath ?? withRelativePath[FILE_WITH_RELATIVE_PATH];

  const normalized = rawRelativePath
    ?.replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/");

  return normalized || undefined;
}

export function getUploadValidationError(file: File) {
  const fileExtension = getUploadFileExtension(file.name);

  if (![".md", ".docx", ".doc", ".pdf"].includes(fileExtension)) {
    return "Formato nao suportado. Use .md, .docx, .doc ou .pdf.";
  }

  if (file.size === 0) {
    return "Arquivo vazio.";
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return "Arquivo acima do limite de 5 MB.";
  }

  return null;
}

export function createUploadItems(files: Iterable<File>, now = Date.now()) {
  return Array.from(files).map((file, index) => {
    const relativePath = getRelativePath(file);
    const displayPath = relativePath ?? file.name;
    const validationError = getUploadValidationError(file);

    return {
      id: `${now}-${index}-${displayPath}`,
      file,
      displayPath,
      relativePath,
      status: validationError ? "ignored" : "pending",
      error: validationError ?? undefined,
    } satisfies BaseUploadQueueItem;
  });
}

export function summarizeUploadItems(
  items: Array<{
    status: UploadItemStatus;
    result?: { chunksCreated?: number };
  }>,
): UploadBatchSummary {
  return items.reduce<UploadBatchSummary>(
    (summary, item) => {
      summary.totalSelected += 1;

      if (item.status !== "ignored") {
        summary.totalEligible += 1;
      }

      if (
        item.status === "success" ||
        item.status === "already_ingested" ||
        item.status === "error"
      ) {
        summary.processed += 1;
      }

      if (item.status === "success") {
        summary.succeeded += 1;
      }

      if (item.status === "already_ingested") {
        summary.alreadyIngested += 1;
      }

      if (item.status === "error") {
        summary.failed += 1;
      }

      if (item.status === "ignored") {
        summary.ignored += 1;
      }

      summary.totalChunksCreated += item.result?.chunksCreated ?? 0;

      return summary;
    },
    {
      totalSelected: 0,
      totalEligible: 0,
      processed: 0,
      succeeded: 0,
      alreadyIngested: 0,
      failed: 0,
      ignored: 0,
      totalChunksCreated: 0,
    },
  );
}

export function sanitizeRelativePath(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(
      (segment) =>
        segment &&
        segment !== "." &&
        segment !== ".." &&
        !/^[A-Za-z]:$/.test(segment),
    )
    .join("/");

  return normalized || undefined;
}
