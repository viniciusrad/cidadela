import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { mergePersons } from "@/lib/graph/person-merge";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { canonical, aliases } = body as { canonical?: string; aliases?: string[] };
  if (!canonical?.trim() || !Array.isArray(aliases) || aliases.length === 0) {
    return NextResponse.json({ error: "canonical (string) and aliases (array) required" }, { status: 400 });
  }

  const result = await mergePersons(canonical.trim(), aliases.map((a) => String(a).trim()).filter(Boolean));
  return NextResponse.json(result);
}
