import { appConfig } from "@/lib/config";

const PHARMACY_SEARCH_ORIGIN = "cidadela_agent";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export type PharmacySearchItem = {
  name: string;
  brand?: string;
  price: number;
  listPrice?: number;
  url?: string;
};

export type PharmacySearchGroup = {
  pharmacy: string;
  items: PharmacySearchItem[];
};

export type PharmacySearchResponse = {
  query: string;
  count: number;
  results: PharmacySearchGroup[];
};

export type PharmacySearchOutcome =
  | { ok: true; data: PharmacySearchResponse }
  | {
      ok: false;
      reason: "timeout" | "http_error" | "invalid_response" | "network_error";
      status?: number;
    };

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isPharmacySearchResponse(value: unknown): value is PharmacySearchResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.query === "string" &&
    typeof v.count === "number" &&
    Array.isArray(v.results)
  );
}

export async function searchPharmacies(
  query: string,
  limit?: number,
): Promise<PharmacySearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, reason: "invalid_response" };
  }

  const safeLimit =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)))
      : DEFAULT_LIMIT;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    appConfig.searchPortalTimeoutMs,
  );

  try {
    const response = await fetch(
      joinUrl(appConfig.searchPortalUrl, "/api/public/search"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: trimmed,
          origin: PHARMACY_SEARCH_ORIGIN,
          limit: safeLimit,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.warn(
        "[pharmacy-search] http_error status=%d query=%o",
        response.status,
        trimmed,
      );
      return { ok: false, reason: "http_error", status: response.status };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!isPharmacySearchResponse(payload)) {
      console.warn("[pharmacy-search] invalid_response query=%o", trimmed);
      return { ok: false, reason: "invalid_response" };
    }

    return { ok: true, data: payload };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[pharmacy-search] timeout query=%o", trimmed);
      return { ok: false, reason: "timeout" };
    }
    console.warn(
      "[pharmacy-search] network_error query=%o error=%s",
      trimmed,
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, reason: "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatPrice(value: number) {
  return BRL_FORMATTER.format(value);
}

export function formatPharmacyResultsAsMarkdown(
  data: PharmacySearchResponse,
): string {
  const lines: string[] = [];
  lines.push(`## Preços encontrados para "${data.query}"`);

  if (data.results.length === 0) {
    lines.push("");
    lines.push(
      `Nenhuma farmácia retornou produto disponível para "${data.query}".`,
    );
    return lines.join("\n");
  }

  for (const group of data.results) {
    lines.push("");
    lines.push(`### ${group.pharmacy}`);
    for (const item of group.items) {
      const brand = item.brand ? ` (${item.brand})` : "";
      const price = formatPrice(item.price);
      const listPrice =
        typeof item.listPrice === "number" && item.listPrice > item.price
          ? ` (de ${formatPrice(item.listPrice)})`
          : "";
      const url = item.url ? ` — ${item.url}` : "";
      lines.push(`- ${item.name}${brand} — ${price}${listPrice}${url}`);
    }
  }

  return lines.join("\n");
}
