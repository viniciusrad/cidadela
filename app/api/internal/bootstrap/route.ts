import { NextResponse } from "next/server";
import { appConfig } from "@/lib/config";
import { ensureBusBootstrapped } from "@/lib/bus/bootstrap";
import { ensureAllSectorCollections } from "@/lib/qdrant";
import { ensureGraphConstraints } from "@/lib/graph/persistence";
import { syncSectorNodes } from "@/lib/graph/sector-sync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Simple token protection based on existing internal token or localhost fallback assumption.
  // We use HUMAN_CAPTCHA_INTERNAL_TOKEN as a generic internal service token for now.
  const authHeader = request.headers.get("Authorization");
  const expectedToken = appConfig.humanCaptchaInternalToken;
  
  if (expectedToken) {
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const results = {
      bus: false,
      qdrant: false,
      graph: false,
      sectorNodes: false,
    };

    // 1. Bus / RabbitMQ
    try {
      await ensureBusBootstrapped();
      results.bus = true;
    } catch (err) {
      console.error("[bootstrap] RabbitMQ failed:", err);
    }

    // 2. Qdrant
    try {
      await ensureAllSectorCollections();
      results.qdrant = true;
    } catch (err) {
      console.error("[bootstrap] Qdrant failed:", err);
    }

    // 3. Graph Constraints (Neo4j)
    try {
      const { failed } = await ensureGraphConstraints();
      if (failed.length > 0) {
        console.warn("[bootstrap] Neo4j constraints with failures:", failed);
      }
      results.graph = failed.length === 0;
    } catch (err) {
      console.error("[bootstrap] Neo4j constraints failed:", err);
    }

    // 4. Sector nodes (Neo4j projection of SectorDefinition)
    try {
      const { failed } = await syncSectorNodes();
      if (failed.length > 0) {
        console.warn("[bootstrap] Sector node sync with failures:", failed);
      }
      results.sectorNodes = failed.length === 0;
    } catch (err) {
      console.error("[bootstrap] Sector node sync failed:", err);
    }

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal Server Error", details: String(error) },
      { status: 500 }
    );
  }
}
