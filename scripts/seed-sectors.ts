import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Sector } from "../lib/domain";
import { prepareUploadedDocument } from "../lib/document";
import { getEmbedding } from "../lib/ollama";
import { replaceSectorDocumentChunks } from "../lib/qdrant";

const sectors: Sector[] = ["desenvolvimento", "seguranca", "suporte"];

async function main() {
  for (const sector of sectors) {
    const dir = path.resolve(process.cwd(), "seed-docs", sector);
    const files = await readdir(dir);

    for (const fileName of files) {
      const filePath = path.join(dir, fileName);
      const buffer = await readFile(filePath);
      const prepared = await prepareUploadedDocument({
        fileName,
        buffer,
        sourceFormat: "markdown",
      });

      const chunksWithVectors = await Promise.all(
        prepared.chunks.map(async (chunk) => ({
          ...chunk,
          vector: await getEmbedding(chunk.content),
        })),
      );

      await replaceSectorDocumentChunks(
        sector,
        prepared.documentId,
        chunksWithVectors,
      );

      console.log(
        `[seed-sectors] ${sector}: ${prepared.metadata.title} (${prepared.chunks.length} chunks)`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
