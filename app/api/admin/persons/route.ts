import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getPersonRelations,
  listPersonProfiles,
  upsertPersonProfile,
} from "@/lib/graph/person-registry";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const sector = searchParams.get("sector") || null;
  const name = searchParams.get("name");

  if (name) {
    const relations = await getPersonRelations(name).catch(() => null);
    if (!relations) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ name, relations });
  }

  const profiles = await listPersonProfiles(sector);
  return NextResponse.json({ profiles });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { name, email, manualSector, jobTitle } = body as Record<string, unknown>;
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  await upsertPersonProfile({
    name,
    email: typeof email === "string" ? email || null : undefined,
    manualSector: typeof manualSector === "string" ? manualSector || null : undefined,
    jobTitle: typeof jobTitle === "string" ? jobTitle || null : undefined,
  });

  return NextResponse.json({ ok: true, name });
}
