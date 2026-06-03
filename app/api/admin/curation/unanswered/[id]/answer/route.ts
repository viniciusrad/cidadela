import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { createStagedCurationDocument, linkUnansweredToCuration } from "@/lib/curation/create";
import { prisma } from "@/lib/db/client";
import { parseCurationFrontmatter } from "@/lib/frontmatter";
import { prepareMarkdownDocument } from "@/lib/markdown";
import { normalizeSensitivity } from "@/lib/sensitivity";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function escapeFrontmatter(value: string) {
  return value.replace(/"/g, '\\"').replace(/\n/g, " ").trim();
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: unknown;
    topic?: unknown;
    sensitivity?: unknown;
    answerText?: unknown;
  };
  const answerText =
    typeof body.answerText === "string" ? body.answerText.trim() : "";
  if (!answerText) {
    return jsonError("Informe o texto da resposta.");
  }

  const question = await prisma.unansweredQuestion.findUnique({ where: { id } });
  if (!question) {
    return jsonError("Pergunta nao encontrada.", 404);
  }
  if (question.status !== "open") {
    return jsonError("Esta pergunta ja foi respondida ou descartada.", 409);
  }

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : `Resposta: ${question.question.slice(0, 60)}`;
  const topic =
    typeof body.topic === "string" && body.topic.trim()
      ? body.topic.trim()
      : undefined;
  const sensitivity = normalizeSensitivity(
    typeof body.sensitivity === "string" ? body.sensitivity : undefined,
  );

  const frontmatterLines = [
    "---",
    `title: "${escapeFrontmatter(title)}"`,
    `sector: ${question.sector}`,
    `sensitivity: ${sensitivity}`,
    `type: conversa`,
  ];
  if (topic) {
    frontmatterLines.push(`topic: "${escapeFrontmatter(topic)}"`);
  }
  frontmatterLines.push("---", "");

  const markdown = [
    frontmatterLines.join("\n"),
    `# ${title}`,
    "",
    "## Pergunta",
    "",
    question.question,
    "",
    "## Resposta",
    "",
    answerText,
    "",
  ].join("\n");

  const prepared = prepareMarkdownDocument({
    fileName: `${slugify(title) || "resposta"}.md`,
    markdown,
    responsibleArea: question.sector,
    sourceFormat: "markdown",
    sourceOrigin: "upload",
    title,
  });

  if (!prepared.normalizedMarkdown || prepared.chunks.length === 0) {
    return jsonError("Nao foi possivel gerar conteudo a partir da resposta.", 422);
  }

  const frontmatter = parseCurationFrontmatter(prepared.normalizedMarkdown);

  const result = await createStagedCurationDocument({
    prepared,
    frontmatter,
    fileName: prepared.metadata.fileName,
    detectedFormat: "markdown",
    relativePath: null,
    targetSector: question.sector,
    uploadedById: session.user.id,
    fileSizeBytes: Buffer.byteLength(markdown, "utf8"),
    traceId: randomUUID(),
    rawDocumentType: "conversa",
  });

  await linkUnansweredToCuration({
    unansweredQuestionId: question.id,
    curationDocumentId: result.document.id,
    resolvedById: session.user.id,
    answerType: "direct",
    answerText,
  });

  return Response.json({
    unansweredQuestionId: question.id,
    status: "answered",
    curationDocumentId: result.document.id,
    documentId: result.documentId,
    documentTitle: result.documentTitle,
    sector: result.sector,
    documentStatus: result.status,
    chunksCreated: result.chunksCreated,
    message:
      "Resposta enviada para curadoria como documento em staging. Apos aprovacao e promocao, o autor da pergunta sera notificado.",
  });
}
