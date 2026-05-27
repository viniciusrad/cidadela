import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { classifyDocument } from "@/lib/document-classifier";
import { prepareUploadedDocument } from "@/lib/document";
import { parseCurationFrontmatter } from "@/lib/frontmatter";
import {
  getUploadFileExtension,
  isUploadFileEntry,
  MAX_UPLOAD_SIZE_BYTES,
  sanitizeRelativePath,
} from "@/lib/upload";

export const runtime = "nodejs";

function sourceFormatFromName(fileName: string) {
  const extension = getUploadFileExtension(fileName);

  if (extension === ".docx") {
    return "docx" as const;
  }

  if (extension === ".doc") {
    return "doc" as const;
  }

  if (extension === ".pdf") {
    return "pdf" as const;
  }

  if (extension === ".md") {
    return "markdown" as const;
  }

  return null;
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const relativePath = sanitizeRelativePath(formData.get("relativePath"));

  if (!isUploadFileEntry(file)) {
    return jsonError("Envie um arquivo valido no campo 'file'.");
  }

  if (file.size === 0) {
    return jsonError("O arquivo enviado esta vazio.");
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return jsonError("O arquivo excede o limite de 5 MB.");
  }

  const sourceFormat = sourceFormatFromName(file.name);
  if (!sourceFormat) {
    return jsonError("Formato nao suportado. Use .md, .docx, .doc ou .pdf.");
  }

  const prepared = await prepareUploadedDocument({
    fileName: file.name,
    buffer: Buffer.from(await file.arrayBuffer()),
    sourceFormat,
    relativePath,
  });
  const frontmatter = parseCurationFrontmatter(prepared.normalizedMarkdown);
  const classification = classifyDocument({
    fileName: file.name,
    markdown: prepared.normalizedMarkdown,
    frontmatter: frontmatter.metadata,
  });

  return Response.json({
    ...classification,
    classificationSource: "heuristic",
    sourceFormat,
    normalizedTitle: classification.title ?? prepared.metadata.title,
  });
}
