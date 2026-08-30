import { describe, expect, it } from "vitest";

import { extractPersonsFromText } from "@/lib/graph/extractor";

describe("extractPersonsFromText", () => {
  it("extracts name from corporate email address", () => {
    const text = "owner: anderson.souza@cidadela.com.br";
    expect(extractPersonsFromText(text)).toContain("Anderson Souza");
  });

  it("extracts multiple corporate emails", () => {
    const text = `
lucia.pereira@cidadela.com.br
henrique.andrade@cidadela.com.br
carla.mendes@cidadela.com.br
    `;
    const result = extractPersonsFromText(text);
    expect(result).toContain("Lucia Pereira");
    expect(result).toContain("Henrique Andrade");
    expect(result).toContain("Carla Mendes");
  });

  it("extracts executor and aprovador role assignments", () => {
    const text = `
## Responsaveis
- Executor: Daniel Moraes
- Aprovador: Daniel Moraes
- Dono do conhecimento: anderson.souza@cidadela.com.br
    `;
    const result = extractPersonsFromText(text);
    expect(result).toContain("Daniel Moraes");
    expect(result).toContain("Anderson Souza");
  });

  it("extracts name from wiki 'Last updated by' header", () => {
    const text = "Last updated by | Daniel Moraes de Souza | 13 de jan. de 2026";
    const result = extractPersonsFromText(text);
    expect(result).toContain("Daniel Moraes de Souza");
  });

  it("extracts team members in Name - Role format", () => {
    const text = `
**Equipe(s) Envolvida(s):**

Carla Mendes - Canais Digitais
Rodrigo Bastos e Daniel Moraes - Squad Web (TI)
Renata Castro (Stakeholder)
    `;
    const result = extractPersonsFromText(text);
    expect(result).toContain("Carla Mendes");
    expect(result).toContain("Renata Castro");
  });

  it("extracts two names joined by 'e'", () => {
    const text = "Henrique Andrade e Carla Mendes (Canais Digitais)";
    const result = extractPersonsFromText(text);
    expect(result).toContain("Henrique Andrade");
    expect(result).toContain("Carla Mendes");
  });

  it("extracts name before parenthesised external email", () => {
    const text = "Aline Faria (contato@parceiro.com.br) do time de dados.";
    const result = extractPersonsFromText(text);
    expect(result).toContain("Aline Faria");
  });

  it("returns empty array when no person patterns match", () => {
    const text = `
## Transações SAP
VA21 Criar Cotação
VF01 Criar documento de faturamento
ZSD167 Cockpit Dicionário de dados
    `;
    expect(extractPersonsFromText(text)).toHaveLength(0);
  });

  it("deduplicates the same person mentioned multiple times", () => {
    const text = `
Executor: Daniel Moraes
Aprovador: Daniel Moraes
    `;
    const result = extractPersonsFromText(text);
    expect(result.filter((p) => p === "Daniel Moraes")).toHaveLength(1);
  });

  it("ignores noise phrases that match the name pattern", () => {
    const text = `
Nova Química integração
Mercado Farma distribuição
Canais Digitais equipe
    `;
    // These are org/system names, not people
    const result = extractPersonsFromText(text);
    expect(result).not.toContain("Nova Química");
    expect(result).not.toContain("Mercado Farma");
    expect(result).not.toContain("Canais Digitais");
  });
});
