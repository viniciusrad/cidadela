import { prisma } from "@/lib/db/client";
import { syncShareableKnowledgeCapabilities } from "@/lib/knowledge/capabilities";

async function main() {
  const result = await syncShareableKnowledgeCapabilities();
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
