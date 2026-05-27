import { appConfig } from "@/lib/config";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const CLIENT_NAME = "pfrm-secure-agents";
const CLIENT_VERSION = "1.0.0";

// MCP Streamable HTTP returns either a JSON body OR an SSE stream depending on
// the server. For the mcp-edi server (NestJS) the tool calls come back as SSE
// frames carrying a single JSON-RPC payload. We parse both shapes defensively.

type McpToolName =
  | "buscar_cliente_por_cnpj"
  | "buscar_cliente_por_codigo"
  | "buscar_cliente_por_nome"
  | "buscar_pedido_por_processo"
  | "buscar_pedido_por_idoc";

export type McpEdiToolName = McpToolName;

export type McpEdiToolArguments =
  | { cnpj: string; limit?: number }
  | { codigo: number; limit?: number }
  | { nome: string; limit?: number }
  | { processo: string; limit?: number }
  | { codidoc: number; limit?: number };

type McpEdiToolPayload = {
  total: number;
  rows: Array<Record<string, unknown>>;
};

export type McpEdiToolOutcome =
  | { ok: true; data: McpEdiToolPayload; raw: string }
  | {
      ok: false;
      reason:
        | "timeout"
        | "http_error"
        | "invalid_response"
        | "network_error"
        | "tool_error"
        | "disabled";
      status?: number;
      message?: string;
    };

type SessionState = {
  sessionId: string;
  initializedAt: number;
};

let cachedSession: SessionState | null = null;
const SESSION_TTL_MS = 5 * 60 * 1000;

function baseHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
}

function jsonRpcId() {
  return Math.floor(Math.random() * 1_000_000) + 1;
}

async function parseMcpResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // SSE frames separated by blank lines; pick the first "data: ..." payload
  // that parses as JSON.
  const lines = text.split(/\r?\n/);
  let buffer = "";
  for (const line of lines) {
    if (line.startsWith("data:")) {
      buffer += line.slice(5).trimStart();
    } else if (line.trim() === "" && buffer) {
      try {
        return JSON.parse(buffer);
      } catch {
        buffer = "";
      }
    }
  }
  if (buffer) {
    try {
      return JSON.parse(buffer);
    } catch {
      return null;
    }
  }
  return null;
}

async function performInitialize(
  url: string,
  signal: AbortSignal,
): Promise<SessionState> {
  const response = await fetch(url, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: jsonRpcId(),
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`initialize_http_${response.status}`);
  }

  const sessionId =
    response.headers.get("mcp-session-id") ??
    response.headers.get("Mcp-Session-Id");

  if (!sessionId) {
    throw new Error("initialize_missing_session_id");
  }

  await parseMcpResponse(response);

  const notifyHeaders = { ...baseHeaders(), "Mcp-Session-Id": sessionId };
  await fetch(url, {
    method: "POST",
    headers: notifyHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    signal,
  }).catch(() => undefined);

  return { sessionId, initializedAt: Date.now() };
}

async function getSession(url: string, signal: AbortSignal) {
  if (
    cachedSession &&
    Date.now() - cachedSession.initializedAt < SESSION_TTL_MS
  ) {
    return cachedSession;
  }
  cachedSession = await performInitialize(url, signal);
  return cachedSession;
}

function extractToolPayload(rpc: unknown): McpEdiToolPayload | null {
  if (typeof rpc !== "object" || rpc === null) return null;
  const root = rpc as Record<string, unknown>;
  const result = root.result as Record<string, unknown> | undefined;
  if (!result || !Array.isArray(result.content)) return null;
  const firstText = (result.content as Array<Record<string, unknown>>).find(
    (item) => item && item.type === "text" && typeof item.text === "string",
  );
  if (!firstText || typeof firstText.text !== "string") return null;
  try {
    const parsed = JSON.parse(firstText.text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).total === "number" &&
      Array.isArray((parsed as Record<string, unknown>).rows)
    ) {
      return parsed as McpEdiToolPayload;
    }
  } catch {
    return null;
  }
  return null;
}

export function resetMcpEdiSession() {
  cachedSession = null;
}

export async function callMcpEdiTool(
  name: McpEdiToolName,
  args: McpEdiToolArguments,
): Promise<McpEdiToolOutcome> {
  if (!appConfig.mcpEdiEnabled) {
    return { ok: false, reason: "disabled" };
  }

  const url = appConfig.mcpEdiUrl;

  // 0.0.0.0 e um endereco de bind ("escute em todas as interfaces"), nao um endereco
  // de conexao. fetch a 0.0.0.0 falha com "fetch failed". Detectamos e abortamos cedo
  // para nao reciclar a sessao MCP em vao.
  if (/:\/\/0\.0\.0\.0(?::|\/|$)/.test(url)) {
    console.warn(
      "[mcp-edi] invalid_config url=%s — 0.0.0.0 nao e um endereco valido de destino. Use 127.0.0.1 (host local) ou host.docker.internal (de dentro de container).",
      url,
    );
    return {
      ok: false,
      reason: "network_error",
      message:
        "MCP_EDI_URL aponta para 0.0.0.0, que e endereco de bind e nao de conexao. Configure 127.0.0.1 (host) ou host.docker.internal (container).",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    appConfig.mcpEdiTimeoutMs,
  );

  try {
    let session: SessionState;
    try {
      session = await getSession(url, controller.signal);
    } catch (err) {
      console.warn(
        "[mcp-edi] initialize failed url=%s err=%s (lembrete: dentro de container use host.docker.internal em vez de 127.0.0.1)",
        url,
        err instanceof Error ? err.message : String(err),
      );
      cachedSession = null;
      return { ok: false, reason: "network_error" };
    }

    let response = await fetch(url, {
      method: "POST",
      headers: { ...baseHeaders(), "Mcp-Session-Id": session.sessionId },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: jsonRpcId(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });

    // Session may have been recycled server-side; re-handshake once.
    if (response.status === 404 || response.status === 410) {
      cachedSession = null;
      session = await getSession(url, controller.signal);
      response = await fetch(url, {
        method: "POST",
        headers: { ...baseHeaders(), "Mcp-Session-Id": session.sessionId },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: jsonRpcId(),
          method: "tools/call",
          params: { name, arguments: args },
        }),
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      console.warn(
        "[mcp-edi] http_error tool=%s status=%d",
        name,
        response.status,
      );
      return { ok: false, reason: "http_error", status: response.status };
    }

    const rpc = await parseMcpResponse(response);
    if (!rpc || typeof rpc !== "object") {
      console.warn("[mcp-edi] invalid_response tool=%s", name);
      return { ok: false, reason: "invalid_response" };
    }

    const rpcObj = rpc as Record<string, unknown>;
    if (rpcObj.error) {
      const err = rpcObj.error as Record<string, unknown>;
      const message = typeof err.message === "string" ? err.message : undefined;
      console.warn("[mcp-edi] tool_error tool=%s message=%s", name, message);
      return { ok: false, reason: "tool_error", message };
    }

    const result = rpcObj.result as Record<string, unknown> | undefined;
    if (result && result.isError === true) {
      const content = result.content as Array<Record<string, unknown>> | undefined;
      const first = content?.find((c) => c && c.type === "text");
      const message = typeof first?.text === "string" ? first.text : undefined;
      return { ok: false, reason: "tool_error", message };
    }

    const payload = extractToolPayload(rpc);
    if (!payload) {
      return { ok: false, reason: "invalid_response" };
    }

    return { ok: true, data: payload, raw: JSON.stringify(payload) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[mcp-edi] timeout tool=%s", name);
      return { ok: false, reason: "timeout" };
    }
    console.warn(
      "[mcp-edi] network_error tool=%s err=%s",
      name,
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, reason: "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatMcpEdiPayloadAsMarkdown(
  toolName: McpEdiToolName,
  payload: McpEdiToolPayload,
): string {
  const lines: string[] = [];
  lines.push(`## Resultado da consulta ${toolName}`);
  lines.push("");
  lines.push(`Total de linhas: ${payload.total}`);

  if (payload.rows.length === 0) {
    lines.push("");
    lines.push("Nenhuma linha retornada para os parametros informados.");
    return lines.join("\n");
  }

  for (let i = 0; i < payload.rows.length; i++) {
    const row = payload.rows[i];
    lines.push("");
    lines.push(`### Registro ${i + 1}`);
    for (const [key, value] of Object.entries(row)) {
      lines.push(`- ${key}: ${formatValue(value)}`);
    }
  }

  return lines.join("\n");
}
