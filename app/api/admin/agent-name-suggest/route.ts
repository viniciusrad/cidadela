import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { appConfig } from "@/lib/config";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  slug: z.string().min(1).max(80),
  displayName: z.string().max(120).optional().default(""),
  mode: z.enum(["agent", "display"]).optional().default("agent"),
});

async function callOllamaGenerate(prompt: string): Promise<string> {
  const response = await fetch(`${appConfig.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: appConfig.ollamaChatModel,
      prompt,
      stream: false,
      think: false,
      options: { temperature: 0.9, top_p: 0.95 },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama retornou ${response.status}`);
  }

  const data = (await response.json()) as { response?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.response?.trim() ?? "";
}

function parseNames(raw: string): string[] {
  // Try JSON array first: ["A","B","C"]
  const jsonMatch = raw.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        const names = parsed
          .map((n) => (typeof n === "string" ? n.trim() : ""))
          .filter((n) => n.length >= 2 && n.length <= 40);
        if (names.length >= 2) return names.slice(0, 3);
      }
    } catch {
      // fall through
    }
  }

  // Fallback: extract the first word of each line (strip explanations after →, -, :)
  const lines = raw
    .split("\n")
    .map((l) =>
      l
        .replace(/^[\s\-*•\d.)>"']+/, "")  // strip list prefixes
        .replace(/[\s→\-:][\s\S]*/, "") // strip everything after separator
        .replace(/["']/g, "")
        .trim(),
    )
    .filter((l) => l.length >= 2 && l.length <= 40 && /^[A-Za-zÀ-ÿ]/.test(l));

  return lines.slice(0, 3);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corpo invalido.", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Dados invalidos.", 400);
  }

  const { slug, displayName } = parsed.data;
  const context = displayName.trim()
    ? `${slug} (${displayName.trim()})`
    : slug;

  const userPrompt = `Nomeie um agente de IA para o setor: ${context}.

REGRA: UMA unica palavra evocativa, ou composto com hifen. NUNCA cargo (Gerente, Analista, Especialista). NUNCA generico (Agente, Bot, Sistema).

Exemplos de estilo APROVADO (slug -> nome: raciocinio):
visitantes -> Vitoria: garante o sucesso do visitante
visitantes -> Concierge: atende qualquer demanda com elegancia
visitantes -> Guia: conduz o visitante pela empresa
desenvolvimento -> Forja: onde o codigo e moldado
seguranca -> Sentinela: guarda as fronteiras
financeiro -> Cofre: onde o valor e custodiado
logistica -> Rota: o caminho que as coisas percorrem
juridico -> Codex: o livro sagrado das regras
inovacao -> Farol: ilumina o caminho que ainda nao existe
rh -> Colmeia: comunidade organizada e colaborativa
suporte -> Nexo: ponto de conexao entre usuario e solucao
compras -> Aduana: onde tudo passa e e inspecionado
dados -> Oraculo: responde com base em evidencias

Parta do slug "${slug}" para criar 3 nomes criativos com logicas distintas entre si.

Responda SOMENTE com array JSON de 3 strings, sem explicacao:
["Nome1", "Nome2", "Nome3"]`;

  try {
    const raw = await callOllamaGenerate(userPrompt);
    const names = parseNames(raw);

    if (names.length < 2) {
      return jsonError("O modelo nao retornou sugestoes validas. Tente novamente.", 502);
    }

    return Response.json({ names });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao chamar o modelo.";
    return jsonError(`Falha ao gerar sugestoes: ${message}`, 502);
  }
}
