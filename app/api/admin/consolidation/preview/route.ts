import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  previewConsolidationArtifact,
  type ConsolidationArtifactType,
  type ConsolidationCandidate,
} from "@/lib/consolidation";

export const runtime = "nodejs";

type SseEvent =
  | { type: "progress"; percent: number; label: string }
  | { type: "result"; payload: unknown }
  | { type: "error"; message: string };

function encodeEvent(event: SseEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Restrito a administradores.", 403);
  }

  let body: {
    candidate?: ConsolidationCandidate;
    artifactType?: ConsolidationArtifactType;
    clarificationAnswers?: Record<string, string>;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Corpo da requisicao invalido.", 400);
  }

  if (!body.candidate) {
    return jsonError("Candidato de consolidacao ausente.", 400);
  }

  if (body.artifactType !== "sop" && body.artifactType !== "ddp") {
    return jsonError("Tipo de artefato invalido.", 400);
  }

  const candidate = body.candidate;
  const artifactType = body.artifactType;
  const clarificationAnswers = body.clarificationAnswers;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const result = await previewConsolidationArtifact({
          candidate,
          artifactType,
          clarificationAnswers,
          onProgress: ({ percent, label }) => {
            controller.enqueue(encodeEvent({ type: "progress", percent, label }));
          },
        });

        controller.enqueue(encodeEvent({ type: "result", payload: result }));
      } catch (error) {
        controller.enqueue(
          encodeEvent({
            type: "error",
            message: error instanceof Error ? error.message : "Falha ao gerar previa.",
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
