import { expect, test } from "@playwright/test";

const ADMIN = {
  email: "admin@cidadela.local",
  password: "admin123",
};

const surfaces = [
  ["painel", "/", "Painel de operacao"],
  ["chat", "/chat", "Converse com os agentes"],
  ["ingestao", "/files", "Ingestao de arquivos"],
  ["curadoria", "/admin/curation", "Curadoria"],
  ["conteudo", "/admin/content", "Gerenciamento de conteudo"],
  ["consolidacao", "/admin/consolidation", "Consolidacao"],
  ["grafo", "/admin/knowledge-graph", "Mapa do conhecimento"],
  ["pessoas", "/admin/people-reclassify", "Reclassificar pessoas"],
  ["processos", "/admin/process-automation-map", "Mapa de processos"],
  ["agentes", "/admin/agents?tab=agents", "Central de agentes"],
  ["responsaveis", "/admin/agents?tab=owners", "Responsaveis pelo conhecimento"],
  ["feedback", "/admin/governance?tab=feedback", "Feedback de respostas"],
  ["correcoes", "/admin/governance?tab=corrections", "Correcoes de conteudo"],
  ["historico", "/admin/governance?tab=audit", "Historico operacional"],
] as const;

test.describe("Superficies disponiveis ao administrador", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(ADMIN.email);
    await page.locator('input[name="password"]').fill(ADMIN.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/");
  });

  for (const [name, url, title] of surfaces) {
    test(`admin acessa ${name}`, async ({ page }) => {
      await page.goto(url);
      await expect(page).toHaveURL(new RegExp(`${url.replace(/[?]/g, "\\?")}$`));
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    });
  }
});
