import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import type { SopSuggestion } from "@/lib/sop-discovery";
import { previewSopFromSuggestion, saveSopDraft } from "@/lib/sop-discovery";

export const runtime = "nodejs";

type SopGenerateRequest = {
  action?: "preview" | "save";
  sector?: string;
  suggestion?: SopSuggestion;
  draft?: {
    sopPath?: string;
    markdown?: string;
    previousSopPath?: string;
    sourceDocumentCount?: number;
    fallbackTitle?: string;
  };
};

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Restrito a administradores do setor.", 403);
  }

  let body: SopGenerateRequest;
  try {
    body = (await request.json()) as SopGenerateRequest;
  } catch {
    return jsonError("Corpo da requisicao invalido.", 400);
  }

  const sector = body.sector ?? session.user.sector;

  if (!isSector(sector)) {
    return jsonError("Setor invalido.", 400);
  }

  if (session.user.sector !== sector) {
    return jsonError("Acesso restrito ao proprio setor.", 403);
  }

  try {
    if (body.action === "save") {
      if (!body.draft?.sopPath || !body.draft.markdown) {
        return jsonError("Rascunho de SOP ausente.", 400);
      }

      const result = await saveSopDraft(sector, {
        sopPath: body.draft.sopPath,
        markdown: body.draft.markdown,
        previousSopPath: body.draft.previousSopPath,
        sourceDocumentCount: body.draft.sourceDocumentCount ?? 1,
        fallbackTitle: body.draft.fallbackTitle ?? "SOP gerado",
      });

      return Response.json(result);
    }

    if (!body.suggestion) {
      return jsonError("Sugestao de SOP ausente.", 400);
    }

    const result = await previewSopFromSuggestion(sector, body.suggestion);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar SOP.";
    return jsonError(message, 500);
  }
}
