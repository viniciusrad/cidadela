import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { findCurationDocumentForActor } from "@/lib/curation/documents";
import {
  generateDocumentImprovement,
  type ImprovementSource,
} from "@/lib/curation/improvement";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { documentId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    sources?: unknown;
  };

  const selectedSources = Array.isArray(body.sources)
    ? (body.sources as ImprovementSource[])
    : [];

  const document = await findCurationDocumentForActor(documentId, session.user);

  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function emit(event: unknown) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      try {
        const generator = await generateDocumentImprovement(
          document,
          selectedSources,
        );

        for await (const chunk of generator) {
          if (chunk.chunk) {
            emit({ type: "chunk", data: { text: chunk.chunk } });
          }
        }

        emit({ type: "done" });
      } catch (error) {
        emit({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Falha ao gerar melhoria assistida.",
        });
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
