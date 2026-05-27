import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  getAccessRulesForSector,
  updateAccessRule,
  type AccessLevel,
} from "@/lib/sectors/access-rules";
import { getSectorDefinition } from "@/lib/sectors/sector-repo";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const { slug } = await context.params;
  const def = await getSectorDefinition(slug);
  if (!def) return jsonError("Setor nao encontrado.", 404);

  const rules = await getAccessRulesForSector(slug);
  return Response.json({ rules });
}

const patchSchema = z.object({
  toSector: z.string().min(1).max(50),
  accessLevel: z.enum(["public", "full", "denied"]).optional(),
  routingKeywords: z.array(z.string().max(100)).max(50).optional(),
  enabled: z.boolean().optional(),
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
  const def = await getSectorDefinition(slug);
  if (!def) return jsonError("Setor nao encontrado.", 404);

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

  const { toSector, ...data } = parsed.data;
  const rule = await updateAccessRule(slug, toSector, data as {
    accessLevel?: AccessLevel;
    routingKeywords?: string[];
    enabled?: boolean;
  });

  return Response.json({ rule });
}
