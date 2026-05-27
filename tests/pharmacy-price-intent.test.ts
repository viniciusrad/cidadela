import { describe, expect, it } from "vitest";

import {
  extractSearchQuery,
  shouldTriggerPharmacyPriceLookup,
} from "../lib/automation/pharmacy-price-intent";
import { detectHumanCaptchaAutomationIntent } from "../lib/automation/cervello-ticket";
import { formatPharmacyResultsAsMarkdown } from "../lib/integrations/pharmacy-search";

describe("shouldTriggerPharmacyPriceLookup", () => {
  it("detects conversational price questions about a medication", () => {
    expect(shouldTriggerPharmacyPriceLookup("quanto custa o dorflex?")).toBe(true);
    expect(
      shouldTriggerPharmacyPriceLookup("qual o menor preço do paracetamol?"),
    ).toBe(true);
    expect(
      shouldTriggerPharmacyPriceLookup("preço da novalgina hoje"),
    ).toBe(true);
  });

  it("detects pharmacy-specific availability questions", () => {
    expect(
      shouldTriggerPharmacyPriceLookup("tem dipirona na drogasil?"),
    ).toBe(true);
  });

  it("does not trigger for artifact/report requests", () => {
    expect(
      shouldTriggerPharmacyPriceLookup(
        "gerar relatorio de precos de medicamentos hoje",
      ),
    ).toBe(false);
    expect(
      shouldTriggerPharmacyPriceLookup(
        "criar arquivo de pesquisa de cotacoes de remedios",
      ),
    ).toBe(false);
  });

  it("does not trigger for unrelated questions", () => {
    expect(
      shouldTriggerPharmacyPriceLookup(
        "explique como funciona a politica de senhas",
      ),
    ).toBe(false);
  });

  it("reserves the asynchronous medication-price-survey intent for artifact requests", () => {
    // Confirm the two paths do not double-trigger on the same input.
    const artifactPrompt = "gerar arquivo de preco de medicamentos para acompanhamento";
    expect(shouldTriggerPharmacyPriceLookup(artifactPrompt)).toBe(false);
    expect(detectHumanCaptchaAutomationIntent(artifactPrompt)).toBe(
      "medication-price-survey",
    );

    const conversationalPrompt = "quanto custa o dorflex hoje?";
    expect(shouldTriggerPharmacyPriceLookup(conversationalPrompt)).toBe(true);
    expect(detectHumanCaptchaAutomationIntent(conversationalPrompt)).toBeNull();
  });
});

describe("extractSearchQuery", () => {
  it("strips stop words and price phrasing", () => {
    const q = extractSearchQuery("quanto custa o dorflex?");
    expect(q).toContain("dorflex");
  });

  it("returns a non-empty string for typical product queries", () => {
    expect(extractSearchQuery("qual o menor preço do paracetamol?").length).toBeGreaterThan(0);
    expect(extractSearchQuery("preço da novalgina hoje").length).toBeGreaterThan(0);
  });
});

describe("formatPharmacyResultsAsMarkdown", () => {
  it("renders pharmacies and items with BRL formatting and list price when present", () => {
    const md = formatPharmacyResultsAsMarkdown({
      query: "dipirona",
      count: 2,
      results: [
        {
          pharmacy: "Drogasil",
          items: [
            {
              name: "Dipirona Sódica 500mg 10 Comprimidos",
              brand: "Medley",
              price: 4.89,
              url: "https://example.com/a",
            },
            {
              name: "Dipirona Monoidratada 1g 10 Comprimidos",
              brand: "EMS",
              price: 8.49,
              listPrice: 12.9,
              url: "https://example.com/b",
            },
          ],
        },
      ],
    });

    expect(md).toContain('## Preços encontrados para "dipirona"');
    expect(md).toContain("### Drogasil");
    expect(md).toMatch(/R\$\s*4,89/);
    expect(md).toMatch(/R\$\s*8,49/);
    expect(md).toMatch(/de R\$\s*12,90/);
    expect(md).toContain("https://example.com/a");
  });

  it("handles empty results", () => {
    const md = formatPharmacyResultsAsMarkdown({
      query: "xyz",
      count: 0,
      results: [],
    });
    expect(md).toContain('Nenhuma farmácia retornou produto disponível para "xyz".');
  });
});
