import { prisma } from "@/lib/db/client";

export type FewShotRecord = {
  id: string;
  sector: string;
  inputPattern: string;
  agentResponse: string;
  domainTags: string[];
  score: number;
  approvedBy: string | null;
  promotedAt: Date;
  active: boolean;
};

export async function retrieveFewShotExamples(
  sector: string,
  question: string,
  options: { topK: number } = { topK: 2 },
): Promise<FewShotRecord[]> {
  try {
    const all = await prisma.fewShotExample.findMany({
      where: { sector, active: true },
      orderBy: { score: "desc" },
    });

    if (all.length === 0) return [];
    if (all.length <= options.topK) return all;

    const questionWords = new Set(
      question
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3),
    );

    const scored = all.map((ex) => {
      const tagHits = ex.domainTags.filter(
        (tag) =>
          questionWords.has(tag.toLowerCase()) ||
          question.toLowerCase().includes(tag.toLowerCase()),
      ).length;
      return { ex, tagHits };
    });

    scored.sort(
      (a, b) => b.tagHits - a.tagHits || b.ex.score - a.ex.score,
    );

    return scored.slice(0, options.topK).map((s) => s.ex);
  } catch {
    return [];
  }
}

export function buildFewShotBlock(examples: FewShotRecord[]): string {
  if (examples.length === 0) return "";
  const lines = [
    "--- EXEMPLOS DE REFERÊNCIA ---",
    "Os seguintes exemplos mostram como responder bem a perguntas similares:",
    "",
    ...examples.map(
      (e, i) =>
        `[Exemplo ${i + 1}]\nPergunta: ${e.inputPattern}\nResposta: ${e.agentResponse}`,
    ),
    "--- FIM DOS EXEMPLOS ---",
  ];
  return lines.join("\n");
}
