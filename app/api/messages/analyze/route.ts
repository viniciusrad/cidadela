import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { getSectorLabel } from "@/lib/labels";
import { analyzeConversation } from "@/lib/messages/analyze";
import { distillConversation } from "@/lib/messages/distill";
import { extractBase64Images } from "@/lib/messages/images";
import { isValidOrigin, normalizeConversation } from "@/lib/messages/normalize";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  let payload: {
    text?: unknown;
    origin?: unknown;
    sector?: unknown;
    images?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonError("Corpo da requisicao invalido. Envie JSON com 'text' e 'origin'.");
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const imagesResult = extractBase64Images(payload.images);
  if (!imagesResult.ok) {
    return jsonError(imagesResult.error);
  }
  if (text.length < 10) {
    return jsonError("Cole o conteudo da conversa antes de analisar. Imagens sao complementares ao texto.");
  }
  if (text.length > 200_000) {
    return jsonError("Conversa muito longa. Divida em trechos de ate 200 mil caracteres.");
  }

  const origin = isValidOrigin(payload.origin) ? payload.origin : "other";
  const sectorSlug =
    typeof payload.sector === "string" && payload.sector.length > 0
      ? payload.sector
      : session.user.sector;
  const sectorLabel = getSectorLabel(sectorSlug);

  const normalized = normalizeConversation({ text, origin });

  const distilled = await distillConversation({
    cleanedText: normalized.cleanedText,
    origin,
    sectorLabel,
    dateFrom: normalized.dateFrom,
    dateTo: normalized.dateTo,
    mentions: normalized.peopleMentioned,
    authorName: session.user.name ?? session.user.email ?? "usuario",
    payloadsDropped: normalized.payloadsDropped,
    title: normalized.suggestedTitle,
    images: imagesResult.base64Images,
  });

  const analysis = await analyzeConversation(distilled.markdown);

  return Response.json({
    origin,
    sector: sectorSlug,
    sectorLabel,
    suggestedTitle: normalized.suggestedTitle,
    fileName: normalized.fileName,
    lineCount: normalized.lineCount,
    peopleMentioned: normalized.peopleMentioned,
    peopleMentionedCount: normalized.peopleMentionedCount,
    dateFrom: normalized.dateFrom,
    dateTo: normalized.dateTo,
    payloadsDropped: normalized.payloadsDropped,
    payloadLinesDropped: normalized.payloadLinesDropped,
    format: normalized.format,
    distilledMarkdown: distilled.markdown,
    knowledge: distilled.knowledge,
    knowledgeItemCount: distilled.itemCount,
    imageCount: imagesResult.base64Images.length,
    analysis,
    submittedBy: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
  });
}
