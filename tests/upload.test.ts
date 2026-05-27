import { describe, expect, it } from "vitest";

import {
  createUploadItems,
  getUploadValidationError,
  sanitizeRelativePath,
  summarizeUploadItems,
} from "@/lib/upload";

describe("upload helpers", () => {
  it("creates queue items preserving relative paths and validation status", () => {
    const supportedFile = new File(["# Guia"], "guia.md", {
      type: "text/markdown",
    });
    Object.defineProperty(supportedFile, "webkitRelativePath", {
      value: "setor/subpasta/guia.md",
      configurable: true,
    });

    const ignoredFile = new File(["conteudo"], "planilha.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const items = createUploadItems([supportedFile, ignoredFile], 123);

    expect(items).toEqual([
      expect.objectContaining({
        id: "123-0-setor/subpasta/guia.md",
        displayPath: "setor/subpasta/guia.md",
        relativePath: "setor/subpasta/guia.md",
        status: "pending",
      }),
      expect.objectContaining({
        id: "123-1-planilha.xlsx",
        displayPath: "planilha.xlsx",
        status: "ignored",
        error: "Formato nao suportado. Use .md, .docx, .doc ou .pdf.",
      }),
    ]);
  });

  it("summarizes queue progress across statuses", () => {
    const summary = summarizeUploadItems([
      { status: "success", result: { chunksCreated: 4 } },
      { status: "already_ingested", result: { chunksCreated: 2 } },
      { status: "error" },
      { status: "ignored" },
      { status: "pending" },
    ]);

    expect(summary).toEqual({
      totalSelected: 5,
      totalEligible: 4,
      processed: 3,
      succeeded: 1,
      alreadyIngested: 1,
      failed: 1,
      ignored: 1,
      totalChunksCreated: 6,
    });
  });

  it("sanitizes relative paths sent by folder uploads", () => {
    expect(sanitizeRelativePath("base\\sub\\arquivo.md")).toBe(
      "base/sub/arquivo.md",
    );
    expect(sanitizeRelativePath("../fora/./arquivo.md")).toBe("fora/arquivo.md");
    expect(sanitizeRelativePath("C:\\base\\arquivo.md")).toBe("base/arquivo.md");
  });

  it("rejects invalid files before upload starts", () => {
    expect(
      getUploadValidationError(
        new File([""], "vazio.md", { type: "text/markdown" }),
      ),
    ).toBe("Arquivo vazio.");
  });
});
