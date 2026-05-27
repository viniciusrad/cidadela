import { appConfig } from "@/lib/config";
import type { GenerationMetrics } from "@/lib/domain";

type OllamaEmbeddingResponse = {
  embedding?: number[];
  error?: string;
};

type OllamaStreamChunk = {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
};

type RerankerResponse = {
  results?: Array<{
    index: number;
    relevance_score: number;
  }>;
};

async function ollamaRequest<TResponse>(
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${appConfig.ollamaUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Falha ao chamar o Ollama (${response.status}): ${details || "sem detalhes"}`,
    );
  }

  return (await response.json()) as TResponse;
}

export async function getEmbedding(input: string) {
  const payload = await ollamaRequest<OllamaEmbeddingResponse>("/api/embeddings", {
    model: appConfig.ollamaEmbedModel,
    prompt: input,
  });

  if (!payload.embedding || payload.embedding.length === 0) {
    throw new Error(payload.error || "Ollama nao retornou embedding.");
  }

  return payload.embedding;
}

export async function rerankDocuments(query: string, documents: string[]) {
  if (documents.length === 0) return [];
  
  // Assume que o endpoint customizado /api/rerank está disponível no mesmo host (ex: plugin Ollama ou proxy)
  const response = await fetch(`${appConfig.ollamaUrl}/api/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: appConfig.rerankerModel,
      query,
      documents,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Falha ao chamar o Reranker (${response.status}): ${details || "sem detalhes"}`,
    );
  }

  const payload = (await response.json()) as RerankerResponse;
  return payload.results ?? [];
}

export async function* generateAnswerStream(
  prompt: string,
  options: { model?: string } = {},
): AsyncGenerator<{ chunk: string; metrics?: GenerationMetrics }> {
  const response = await fetch(`${appConfig.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? appConfig.ollamaChatModel,
      prompt,
      stream: true,
      think: false,
      options: {
        temperature: 0.1,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Falha ao chamar o Ollama (${response.status}): ${details || "sem detalhes"}`,
    );
  }

  if (!response.body) {
    throw new Error("Ollama nao retornou stream de resposta.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        const payload = JSON.parse(line) as OllamaStreamChunk;

        if (payload.error) {
          throw new Error(`Erro do Ollama: ${payload.error}`);
        }

        let metrics: GenerationMetrics | undefined;

        if (payload.done) {
          const totalMs = payload.total_duration ? payload.total_duration / 1e6 : 0;
          const promptEvalMs = payload.prompt_eval_duration ? payload.prompt_eval_duration / 1e6 : 0;
          const tokens = payload.eval_count ?? 0;
          const tokensPerSec = totalMs > 0 ? tokens / (totalMs / 1000) : 0;

          metrics = {
            totalDurationMs: Math.round(totalMs),
            ttftMs: Math.round(promptEvalMs),
            tokensGenerated: tokens,
            tokensPerSecond: Math.round(tokensPerSec * 10) / 10,
          };
        }

        yield {
          chunk: payload.response || "",
          metrics,
        };
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) break;
  }
}

export async function generateJson<T = unknown>(
  prompt: string,
  options: { model?: string; temperature?: number; images?: string[] } = {},
): Promise<T> {
  const response = await fetch(`${appConfig.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model ?? appConfig.ollamaClassifierModel,
      prompt,
      stream: false,
      think: false,
      format: "json",
      ...(options.images && options.images.length > 0
        ? { images: options.images }
        : {}),
      options: {
        temperature: options.temperature ?? 0,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Falha ao chamar o Ollama (${response.status}): ${details || "sem detalhes"}`,
    );
  }

  const payload = (await response.json()) as { response?: string; error?: string };
  if (payload.error) {
    throw new Error(`Erro do Ollama: ${payload.error}`);
  }

  const raw = (payload.response ?? "").trim();
  if (!raw) {
    throw new Error("Ollama nao retornou conteudo JSON.");
  }

  return JSON.parse(raw) as T;
}

export async function describeImage(
  base64Image: string,
  options: { model?: string; prompt?: string } = {},
): Promise<string> {
  const prompt =
    options.prompt ??
    `Voce e um analista visual. Descreva de forma estruturada e factual o conteudo desta imagem para que sirva como contexto textual em uma conversa corporativa.

REGRAS:
- Se a imagem for um print de tela (Teams, WhatsApp, sistema interno, planilha, dashboard), TRANSCREVA o texto visivel verbatim, preservando estrutura (campos, valores, tabelas, mensagens).
- Se for foto/diagrama/grafico, descreva entidades, relacoes, numeros e rotulos relevantes.
- Identifique sistemas, ferramentas, telas, status, codigos de erro ou identificadores tecnicos visiveis.
- Nao especule nem invente conteudo que nao esteja claramente visivel.
- Responda em portugues do Brasil, em texto corrido com listas quando fizer sentido. Sem JSON, sem markdown de cabecalho.`;

  const response = await fetch(`${appConfig.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model ?? appConfig.ollamaChatModel,
      prompt,
      images: [base64Image],
      stream: false,
      think: false,
      options: { temperature: 0 },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Falha ao descrever imagem via Ollama (${response.status}): ${details || "sem detalhes"}`,
    );
  }

  const payload = (await response.json()) as { response?: string; error?: string };
  if (payload.error) {
    throw new Error(`Erro do Ollama (visao): ${payload.error}`);
  }
  return (payload.response ?? "").trim();
}

export async function listOllamaModels(): Promise<string[]> {
  const response = await fetch(`${appConfig.ollamaUrl}/api/tags`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Ollama indisponivel (${response.status}).`);
  }
  const payload = (await response.json()) as OllamaTagsResponse;
  const names = new Set<string>();
  for (const model of payload.models ?? []) {
    if (model.name) names.add(model.name);
    if (model.model) names.add(model.model);
  }
  return Array.from(names).sort();
}

export async function checkOllamaHealth() {
  const response = await fetch(`${appConfig.ollamaUrl}/api/tags`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Ollama indisponivel (${response.status}).`);
  }

  const payload = (await response.json()) as OllamaTagsResponse;
  const installedModels = new Set(
    (payload.models ?? [])
      .flatMap((model) => [model.name, model.model])
      .filter((value): value is string => Boolean(value)),
  );

  if (!installedModels.has(appConfig.ollamaEmbedModel)) {
    throw new Error(
      `Modelo de embedding ausente: ${appConfig.ollamaEmbedModel}`,
    );
  }

  if (!installedModels.has(appConfig.ollamaChatModel)) {
    throw new Error(`Modelo de chat ausente: ${appConfig.ollamaChatModel}`);
  }

  return true;
}
