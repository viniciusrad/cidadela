import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { listAllSectors, createSector } from "@/lib/sectors/sector-repo";
import { provisionSectorResources } from "@/lib/sectors/provisioner";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const sectors = await listAllSectors();
  return Response.json({ sectors });
}

const createSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(50)
    .regex(
      /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/,
      "Slug: apenas letras minusculas, numeros e hifens.",
    ),
  displayName: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  agentName: z.string().min(1).max(80),
  agentSummary: z.string().min(1).max(400),
  agentInstructions: z.string().min(1).max(8000),
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

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corpo invalido.", 400);
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      `Validacao falhou: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }

  try {
    const sector = await createSector({
      ...parsed.data,
      createdBy: session.user.id ?? session.user.email ?? undefined,
    });

    const provisionResult = await provisionSectorResources(sector.slug);

    return Response.json(
      {
        sector,
        provisioning: provisionResult,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Erro ao criar setor.",
      400,
    );
  }
}
