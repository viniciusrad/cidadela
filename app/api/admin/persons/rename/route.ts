import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { renamePerson } from "@/lib/graph/person-merge";

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

  const { currentName, newName } = body as { currentName?: string; newName?: string };
  if (!currentName?.trim() || !newName?.trim()) {
    return NextResponse.json({ error: "currentName and newName required" }, { status: 400 });
  }

  await renamePerson(currentName.trim(), newName.trim());
  return NextResponse.json({ ok: true });
}
