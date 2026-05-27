import { describe, expect, it } from "vitest";

import { extractPersonsFromText } from "@/lib/graph/extractor";

describe("extractPersonsFromText", () => {
  it("extracts name from profarma email address", () => {
    const text = "owner: vinicius.souza@profarma.com.br";
    expect(extractPersonsFromText(text)).toContain("Vinicius Souza");
  });

  it("extracts multiple profarma emails", () => {
    const text = `
tamara.santos@profarma.com.br
thiago.anacleto@profarma.com.br
fernanda.silva@profarma.com.br
    `;
    const result = extractPersonsFromText(text);
    expect(result).toContain("Tamara Santos");
    expect(result).toContain("Thiago Anacleto");
    expect(result).toContain("Fernanda Silva");
  });

  it("extracts executor and aprovador role assignments", () => {
    const text = `
## Responsaveis
- Executor: Vinicius Ribeiro
- Aprovador: Vinicius Ribeiro
- Dono do conhecimento: vinicius.souza@profarma.com.br
    `;
    const result = extractPersonsFromText(text);
    expect(result).toContain("Vinicius Ribeiro");
    expect(result).toContain("Vinicius Souza");
  });

  it("extracts name from wiki 'Last updated by' header", () => {
    const text = "Last updated by | Vinicius Ribeiro de Souza | 13 de jan. de 2026";
    const result = extractPersonsFromText(text);
    expect(result).toContain("Vinicius Ribeiro de Souza");
  });

  it("extracts team members in Name - Role format", () => {
    const text = `
**Equipe(s) Envolvida(s):**

Fernanda Oliveira - Canais Digitais
Adriano Boldi e Vinícius Ribeiro - Squad Web (TI)
Teresa Galvão (Stakeholder)
    `;
    const result = extractPersonsFromText(text);
    expect(result).toContain("Fernanda Oliveira");
    expect(result).toContain("Teresa Galvão");
  });

  it("extracts two names joined by 'e'", () => {
    const text = "Thiago Anacleto e Fernanda Oliveira (Canais Digitais)";
    const result = extractPersonsFromText(text);
    expect(result).toContain("Thiago Anacleto");
    expect(result).toContain("Fernanda Oliveira");
  });

  it("extracts name before parenthesised external email", () => {
    const text = "Tatiane Costa (t0028491@ems.com.br) do time de dados.";
    const result = extractPersonsFromText(text);
    expect(result).toContain("Tatiane Costa");
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
Executor: Vinicius Ribeiro
Aprovador: Vinicius Ribeiro
    `;
    const result = extractPersonsFromText(text);
    expect(result.filter((p) => p === "Vinicius Ribeiro")).toHaveLength(1);
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
