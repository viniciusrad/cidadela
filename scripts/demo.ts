import { randomUUID } from "node:crypto";

import { ensureBusBootstrapped } from "../lib/bus/bootstrap";
import { runSectorAgent } from "../lib/agents/base-agent";

async function main() {
  const traceId = randomUUID();

  await ensureBusBootstrapped();

  const result = await runSectorAgent({
    traceId,
    sector: "desenvolvimento",
    question:
      "Qual e a politica de criacao de senhas seguras para endpoints internos e usuarios privilegiados?",
    emit: (event) => {
      if (event.type === "status") {
        console.log(`[status] ${event.data.message}`);
      }

      if (event.type === "delegation_start") {
        console.log(
          `[delegation:start] ${event.data.from} -> ${event.data.to} (${event.data.intent})`,
        );
      }

      if (event.type === "delegation_result") {
        console.log(
          `[delegation:result] ${event.data.status} :: ${event.data.answer ?? "sem resposta"}`,
        );
      }
    },
  });

  console.log("\n=== RESPOSTA FINAL ===\n");
  console.log(result.answer);
  console.log("\n=== CITACOES ===\n");
  console.log(JSON.stringify(result.citations, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  process.exit();
});
