import { describe, expect, it } from "vitest";

import { detectMcpEdiIntent } from "../lib/automation/mcp-edi-intent";
import { formatMcpEdiPayloadAsMarkdown } from "../lib/integrations/mcp-edi";

describe("detectMcpEdiIntent", () => {
  it("detects CNPJ in masked and unmasked formats", () => {
    expect(detectMcpEdiIntent("buscar cliente com cnpj 12.345.678/0001-90")).toEqual({
      tool: "buscar_cliente_por_cnpj",
      arguments: { cnpj: "12345678000190" },
      description: expect.stringContaining("12345678000190"),
    });

    expect(
      detectMcpEdiIntent("dados do cliente 12345678000190 para conferencia"),
    ).toEqual({
      tool: "buscar_cliente_por_cnpj",
      arguments: { cnpj: "12345678000190" },
      description: expect.stringContaining("12345678000190"),
    });
  });

  it("detects client by codigo", () => {
    const intent = detectMcpEdiIntent("consultar cliente codigo 4521");
    expect(intent).toEqual({
      tool: "buscar_cliente_por_codigo",
      arguments: { codigo: 4521 },
      description: expect.stringContaining("4521"),
    });
  });

  it("detects client by nome", () => {
    const intent = detectMcpEdiIntent('buscar cliente "Drogaria Sao Joao"');
    expect(intent?.tool).toBe("buscar_cliente_por_nome");
    expect(intent?.arguments).toEqual({ nome: "Drogaria Sao Joao" });
  });

  it("detects pedido por processo", () => {
    const intent = detectMcpEdiIntent("buscar pedido com processo ABC-123/45");
    expect(intent?.tool).toBe("buscar_pedido_por_processo");
    expect(intent?.arguments).toEqual({ processo: "ABC-123/45" });
  });

  it("detects pedido por idoc", () => {
    const intent = detectMcpEdiIntent(
      "consultar pedido pelo idoc 987654 por favor",
    );
    expect(intent?.tool).toBe("buscar_pedido_por_idoc");
    expect(intent?.arguments).toEqual({ codidoc: 987654 });
  });

  it("does not trigger for unrelated questions", () => {
    expect(detectMcpEdiIntent("explique como funciona o ciclo de pedidos")).toBeNull();
    expect(detectMcpEdiIntent("qual a politica de senhas?")).toBeNull();
    expect(detectMcpEdiIntent("")).toBeNull();
  });

  it("prefers idoc over generic codigo when both keywords present", () => {
    const intent = detectMcpEdiIntent("buscar pedido idoc 123456 do cliente codigo 9");
    expect(intent?.tool).toBe("buscar_pedido_por_idoc");
    expect(intent?.arguments).toEqual({ codidoc: 123456 });
  });
});

describe("formatMcpEdiPayloadAsMarkdown", () => {
  it("renders rows with all fields", () => {
    const md = formatMcpEdiPayloadAsMarkdown("buscar_cliente_por_cnpj", {
      total: 1,
      rows: [
        {
          codigo: 42,
          cnpj: "12345678000190",
          nome: "Drogaria Exemplo",
          uf: "SP",
        },
      ],
    });

    expect(md).toContain("## Resultado da consulta buscar_cliente_por_cnpj");
    expect(md).toContain("Total de linhas: 1");
    expect(md).toContain("### Registro 1");
    expect(md).toContain("- codigo: 42");
    expect(md).toContain("- cnpj: 12345678000190");
    expect(md).toContain("- nome: Drogaria Exemplo");
  });

  it("handles empty results", () => {
    const md = formatMcpEdiPayloadAsMarkdown("buscar_pedido_por_idoc", {
      total: 0,
      rows: [],
    });
    expect(md).toContain("Total de linhas: 0");
    expect(md).toContain("Nenhuma linha retornada");
  });
});
