import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { loadPendencyOverviewForActor } from "@/lib/notifications/pendencies";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const overview = await loadPendencyOverviewForActor({
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    sector: session.user.sector,
  });

  return Response.json(overview);
}
