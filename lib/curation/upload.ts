import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { prepareUploadedDocument } from "@/lib/document";
import { prisma } from "@/lib/db/client";
import { parseCurationFrontmatter } from "@/lib/frontmatter";
import { isSectorSlug } from "@/lib/sectors/sector-repo";
import {
  getUploadFileExtension,
  isUploadFileEntry,
  MAX_UPLOAD_SIZE_BYTES,
  sanitizeRelativePath,
} from "@/lib/upload";
import { createStagedCurationDocument, linkUnansweredToCuration } from "./create";

function getFileExtension(fileName: string) {
  if (getUploadFileExtension(fileName) === ".docx") {
    return "docx" as const;
  }

  if (getUploadFileExtension(fileName) === ".doc") {
    return "doc" as const;
  }

  if (getUploadFileExtension(fileName) === ".pdf") {
    return "pdf" as const;
  }

  if (getUploadFileExtension(fileName) === ".md") {
    return "markdown" as const;
  }

  return null;
}

export async function handleCuratedUpload(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (!prisma.curationDocument || !prisma.documentReview) {
    return jsonError(
      "Prisma Client sem modelos de curadoria. Rode `npx prisma generate`, aplique as migrations e reinicie o servidor Next.js.",
      503,
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const rawSector = formData.get("sector");
  const rawDocumentType = formData.get("documentType");
  const rawClassificationConfidence = formData.get("classificationConfidence");
  const rawUnansweredQuestionId = formData.get("unansweredQuestionId");
  const relativePath = sanitizeRelativePath(formData.get("relativePath"));
  const traceId = randomUUID();

  if (!isUploadFileEntry(file)) {
    return jsonError("Envie um arquivo valido no campo 'file'.");
  }

  // Determinar setor de destino: admins podem escolher qualquer setor,
  // usuarios comuns ficam restritos ao proprio setor.
  let targetSector: string = session.user.sector;
  if (rawSector !== null) {
    if (typeof rawSector !== "string" || !(await isSectorSlug(rawSector))) {
      return jsonError("Setor de destino invalido.");
    }

    if (session.user.role !== "admin" && rawSector !== targetSector) {
      return jsonError(
        "Cada usuario so pode ingerir documentos no proprio setor.",
        403,
      );
    }

    targetSector = rawSector;
  }

  if (file.size === 0) {
    return jsonError("O arquivo enviado esta vazio.");
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return jsonError("O arquivo excede o limite de 5 MB.");
  }

  const detectedFormat = getFileExtension(file.name);
  if (!detectedFormat) {
    return jsonError("Formato nao suportado. Use .md, .docx, .doc ou .pdf.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const prepared = await prepareUploadedDocument({
    fileName: file.name,
    buffer,
    sourceFormat: detectedFormat,
    relativePath,
  });

  if (!prepared.normalizedMarkdown || prepared.chunks.length === 0) {
    return jsonError("Nao foi possivel gerar chunks a partir do arquivo.");
  }

  const frontmatter = parseCurationFrontmatter(prepared.normalizedMarkdown);
  if (frontmatter.metadata.sector && frontmatter.metadata.sector !== targetSector) {
    return jsonError(
      `O setor declarado no frontmatter (${frontmatter.metadata.sector}) difere do setor de destino selecionado (${targetSector}).`,
      403,
    );
  }

  const result = await createStagedCurationDocument({
    prepared,
    frontmatter,
    fileName: file.name,
    detectedFormat,
    relativePath,
    targetSector,
    uploadedById: session.user.id,
    fileSizeBytes: file.size,
    traceId,
    rawDocumentType,
    rawClassificationConfidence,
  });

  // Optional: this upload answers a queued unanswered question.
  if (
    typeof rawUnansweredQuestionId === "string" &&
    rawUnansweredQuestionId.trim() &&
    session.user.role === "admin"
  ) {
    await linkUnansweredToCuration({
      unansweredQuestionId: rawUnansweredQuestionId.trim(),
      curationDocumentId: result.document.id,
      resolvedById: session.user.id,
      answerType: "upload",
    });
  }

  return Response.json({
    documentId: result.documentId,
    documentTitle: result.documentTitle,
    sector: result.sector,
    status: result.status,
    sopReadinessScore: result.readinessScore,
    curationReadinessScore: result.readinessScore,
    documentType: result.documentType,
    classificationSource: result.classificationSource,
    classificationConfidence: result.classificationConfidence,
    authorityLevel: result.authorityLevel,
    missingReadiness: result.missingReadiness,
    chunksCreated: result.chunksCreated,
    fileName: file.name,
    relativePath,
    message:
      "Documento enviado para staging curado. Ele so sera promovido para producao apos aprovacao, correlacao e geracao do artefato curado. As perguntas de curadoria sao opcionais.",
  });
}
