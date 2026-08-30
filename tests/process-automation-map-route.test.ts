import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, listProcessAutomationMapsMock, refreshProcessAutomationMapMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    listProcessAutomationMapsMock: vi.fn(),
    refreshProcessAutomationMapMock: vi.fn(),
  }));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/process-automation-map", () => ({
  listProcessAutomationMaps: listProcessAutomationMapsMock,
  refreshProcessAutomationMap: refreshProcessAutomationMapMock,
}));

import { GET } from "@/app/api/admin/process-automation-map/route";
import { POST } from "@/app/api/admin/process-automation-map/refresh/route";

describe("process automation map admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@cidadela.local",
        name: "Admin",
        role: "admin",
        sector: "desenvolvimento",
      },
    });
    listProcessAutomationMapsMock.mockResolvedValue({
      kpis: {
        processesMapped: 1,
        automationCandidates: 2,
        processesWithCriticalGaps: 0,
        lowCoverageProcesses: 0,
        processesWithHumanInLoop: 0,
      },
      rows: [],
      backlog: { questions: [], candidates: [] },
      refreshedAt: "2026-05-09T13:00:00.000Z",
    });
    refreshProcessAutomationMapMock.mockResolvedValue({
      refreshed: true,
      processes: 3,
      linkedCandidates: 4,
      refreshedAt: "2026-05-09T13:01:00.000Z",
    });
  });

  it("repasse filtros da listagem para o serviço", async () => {
    const response = await GET({
      nextUrl: new URL(
        "http://localhost/api/admin/process-automation-map?sector=suporte&status=needs_curation&automationLevel=parcial&hasSystem=no&gaps=with&sourceScope=staging&search=incidente",
      ),
    } as never);

    expect(response.status).toBe(200);
    expect(listProcessAutomationMapsMock).toHaveBeenCalledWith({
      search: "incidente",
      sector: "suporte",
      status: "needs_curation",
      automationLevel: "parcial",
      hasSystem: "no",
      gaps: "with",
      sourceScope: "staging",
    });
  });

  it("executa refresh manual de forma idempotente pela rota", async () => {
    const first = await POST();
    const second = await POST();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(refreshProcessAutomationMapMock).toHaveBeenCalledTimes(2);
  });

  it("bloqueia usuario nao admin", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@cidadela.local",
        name: "User",
        role: "user",
        sector: "suporte",
      },
    });

    const response = await POST();
    expect(response.status).toBe(403);
  });
});
