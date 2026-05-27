import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { handleCuratedUpload } from "@/lib/curation/upload";
import { getSectorLabel } from "@/lib/labels";
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
    title?: unknown;
    distilledMarkdown?: unknown;
    images?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonError("Corpo da requisicao invalido. Envie JSON.");
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (text.length < 10) {
    return jsonError("Cole o conteudo da conversa antes de enviar.");
  }
  if (text.length > 200_000) {
    return jsonError("Conversa muito longa. Divida em trechos de ate 200 mil caracteres.");
  }

  const origin = isValidOrigin(payload.origin) ? payload.origin : "other";
  const sector = typeof payload.sector === "string" ? payload.sector : null;
  if (!sector) {
    return jsonError("Selecione o setor de destino.");
  }

  const normalized = normalizeConversation({ text, origin });
  const customTitle =
    typeof payload.title === "string" ? payload.title.trim() : "";
  const finalTitle =
    (customTitle || normalized.suggestedTitle)
      .replace(/\s+/g, " ")
      .slice(0, 140);

  let markdownToIngest =
    typeof payload.distilledMarkdown === "string"
      ? payload.distilledMarkdown.trim()
      : "";

  if (!markdownToIngest) {
    const imagesResult = extractBase64Images(payload.images);
    if (!imagesResult.ok) {
      return jsonError(imagesResult.error);
    }
    const distilled = await distillConversation({
      cleanedText: normalized.cleanedText,
      origin,
      sectorLabel: getSectorLabel(sector),
      dateFrom: normalized.dateFrom,
      dateTo: normalized.dateTo,
      mentions: normalized.peopleMentioned,
      authorName: session.user.name ?? session.user.email ?? "usuario",
      payloadsDropped: normalized.payloadsDropped,
      title: finalTitle,
      images: imagesResult.base64Images,
    });
    markdownToIngest = distilled.markdown;
  } else if (customTitle) {
    markdownToIngest = markdownToIngest.replace(
      /^#\s.*$/m,
      `# ${finalTitle}`,
    );
  }

  const blob = new Blob([markdownToIngest], { type: "text/markdown" });
  const file = new File([blob], normalized.fileName, { type: "text/markdown" });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("sector", sector);
  formData.append("documentType", "conversa");
  formData.append("classificationConfidence", "1");
  formData.append("relativePath", `conversa/${origin}/${normalized.fileName}`);

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("content-type");

  const fabricated = new Request(request.url, {
    method: "POST",
    headers,
    body: formData,
  });

  return handleCuratedUpload(fabricated);
}
