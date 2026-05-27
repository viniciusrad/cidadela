import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { getSectorDefinition, updateSector, disableSector } from "@/lib/sectors/sector-repo";
import { z } from "zod";

export const runtime = "nodejs";

const patchSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
  agentName: z.string().min(1).max(80).optional(),
  agentSummary: z.string().min(1).max(400).optional(),
  agentInstructions: z.string().min(1).max(8000).optional(),
  capabilities: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(120),
        description: z.string().min(1).max(400),
        isExposed: z.boolean(),
      }),
    )
    .max(40)
    .optional(),
  chatModel: z.string().min(1).max(120).optional(),
  topK: z.number().int().min(1).max(20).optional(),
  localConfidenceThreshold: z.number().min(0).max(1).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { slug } = await context.params;
  const existing = await getSectorDefinition(slug);
  if (!existing) return jsonError("Setor nao encontrado.", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corpo invalido.", 400);
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      `Validacao falhou: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }

  const updated = await updateSector(slug, parsed.data);
  return Response.json({ sector: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { slug } = await context.params;

  try {
    await disableSector(slug);
    return Response.json({ disabled: true });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Erro ao desabilitar setor.",
      400,
    );
  }
}
