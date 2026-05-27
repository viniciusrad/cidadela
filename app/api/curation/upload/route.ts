import { handleCuratedUpload } from "@/lib/curation/upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleCuratedUpload(request);
}
