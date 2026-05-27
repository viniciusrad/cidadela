import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getOrgChart } from "@/lib/graph/org-chart";

export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const data = await getOrgChart();
  return NextResponse.json(data);
}
