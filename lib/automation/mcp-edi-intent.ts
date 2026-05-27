import type {
  McpEdiToolArguments,
  McpEdiToolName,
} from "@/lib/integrations/mcp-edi";

export type McpEdiIntent = {
  tool: McpEdiToolName;
  arguments: McpEdiToolArguments;
  description: string;
};

function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function onlyDigits(value: string) {
  return value.replace(/\D+/g, "");
}

const CLIENT_KEYWORDS =
  /\b(cliente|clientes|cadastro|conta|comprador|distribuidor|distribuidora|farmacia|farmacias)\b/;
const ORDER_KEYWORDS = /\b(pedido|pedidos|nota|notas|ordem|ordens|processo|idoc)\b/;
const LOOKUP_VERB =
  /\b(buscar|busca|busque|pesquisar|pesquisa|consultar|consulta|encontrar|ache|achar|listar|mostrar|exibir|trazer|trazer|me traga|me passa|quero|qual|quais)\b/;

function extractDigits(question: string, pattern: RegExp): string | null {
  const match = question.match(pattern);
  if (!match) return null;
  const digits = onlyDigits(match[0]);
  return digits.length > 0 ? digits : null;
}

function extractNomeAfterKeyword(question: string): string | null {
  // Match: "cliente nome XYZ", "cliente chamado XYZ", "cliente XYZ"
  const normalized = question.replace(/\s+/g, " ").trim();
  const patterns: RegExp[] = [
    /cliente(?:s)?\s+(?:de\s+)?nome\s+["']?([^"'?.,;]+?)["']?(?:[?.,;]|$)/i,
    /cliente(?:s)?\s+chamad[oa]\s+["']?([^"'?.,;]+?)["']?(?:[?.,;]|$)/i,
    /razao\s+social\s+["']?([^"'?.,;]+?)["']?(?:[?.,;]|$)/i,
    /(?:buscar|pesquisar|consultar|encontrar|achar|listar|mostrar)\s+(?:o|a|um|uma)?\s*cliente(?:s)?\s+["']?([^"'?.,;]+?)["']?(?:[?.,;]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const candidate = match[1].trim();
      if (candidate.length >= 3 && !/^\d+$/.test(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

export function detectMcpEdiIntent(question: string): McpEdiIntent | null {
  const raw = question.trim();
  if (!raw) return null;

  const normalized = normalizeForMatch(raw);
  const hasClient = CLIENT_KEYWORDS.test(normalized);
  const hasOrder = ORDER_KEYWORDS.test(normalized);
  const hasVerb = LOOKUP_VERB.test(normalized);

  // ============ ORDER LOOKUPS ============

  // buscar pedido idoc 123456
  const idocMatch = normalized.match(
    /\b(?:idoc|codigo idoc|cod idoc|cod\.\s*idoc|codidoc)\s*[:#]?\s*(\d{3,12})\b/,
  );
  if (idocMatch) {
    return {
      tool: "buscar_pedido_por_idoc",
      arguments: { codidoc: Number(idocMatch[1]) },
      description: `Pedido por IDOC ${idocMatch[1]}`,
    };
  }

  // buscar pedido processo ABC123
  const processoMatch = raw.match(
    /\bprocesso\s*[:#]?\s*["']?([A-Za-z0-9._\-/]{3,40})["']?/i,
  );
  if (processoMatch && (hasOrder || hasVerb)) {
    return {
      tool: "buscar_pedido_por_processo",
      arguments: { processo: processoMatch[1] },
      description: `Pedido por processo ${processoMatch[1]}`,
    };
  }

  // ============ CLIENT LOOKUPS ============

  // CNPJ (14 dígitos, com ou sem máscara)
  const cnpjMatch = raw.match(
    /\b(\d{2}[.\-/]?\d{3}[.\-/]?\d{3}[.\-/]?\d{4}[.\-/]?\d{2})\b/,
  );
  if (cnpjMatch) {
    const digits = onlyDigits(cnpjMatch[1]);
    if (digits.length === 14) {
      return {
        tool: "buscar_cliente_por_cnpj",
        arguments: { cnpj: digits },
        description: `Cliente por CNPJ ${digits}`,
      };
    }
  }

  // cliente codigo 1234 / cliente cod 1234 / cliente id 1234
  const codigoDigits = extractDigits(
    normalized,
    /\b(?:codigo|cod|cod\.|id)\s*[:#]?\s*\d{1,10}\b/,
  );
  if (codigoDigits && hasClient) {
    return {
      tool: "buscar_cliente_por_codigo",
      arguments: { codigo: Number(codigoDigits) },
      description: `Cliente por codigo ${codigoDigits}`,
    };
  }

  // Nome do cliente (≥ 3 chars)
  if (hasClient && hasVerb) {
    const nome = extractNomeAfterKeyword(raw);
    if (nome) {
      return {
        tool: "buscar_cliente_por_nome",
        arguments: { nome },
        description: `Cliente por nome ${nome}`,
      };
    }
  }

  return null;
}

export function describeMcpEdiOutcomeReason(reason: string): string {
  switch (reason) {
    case "timeout":
      return "tempo de resposta excedido";
    case "http_error":
      return "erro HTTP no servidor MCP";
    case "invalid_response":
      return "resposta invalida do servidor MCP";
    case "network_error":
      return "falha de rede ao falar com o servidor MCP";
    case "tool_error":
      return "a ferramenta MCP retornou erro";
    case "disabled":
      return "integracao MCP-EDI desabilitada";
    default:
      return reason;
  }
}
