import { describe, expect, it } from "vitest";

import {
  approvalGateFromApprovals,
  canApproveAsOwner,
  hasRequiredApprovals,
} from "@/lib/curation/documents";

describe("approvalGateFromApprovals", () => {
  it("aceita uma unica aprovacao de owner ou admin para liberar promote", () => {
    expect(approvalGateFromApprovals([])).toMatchObject({
      hasOwnerApproval: false,
      hasAdminApproval: false,
      hasAnyApproval: false,
      missingApprovals: ["owner", "admin"],
      canPromote: false,
    });

    expect(
      approvalGateFromApprovals([
        {
          approverId: "user-1",
          approverRole: "owner",
          decision: "approved",
        },
      ]),
    ).toMatchObject({
      hasOwnerApproval: true,
      hasAdminApproval: false,
      hasAnyApproval: true,
      missingApprovals: [],
      canPromote: true,
    });

    const approvals = [
      {
        approverId: "user-1",
        approverRole: "owner",
        decision: "approved",
      },
      {
        approverId: "admin-1",
        approverRole: "admin",
        decision: "approved",
      },
    ];

    expect(hasRequiredApprovals(approvals)).toBe(true);
    expect(approvalGateFromApprovals(approvals)).toMatchObject({
      hasOwnerApproval: true,
      hasAdminApproval: true,
      hasAnyApproval: true,
      missingApprovals: [],
      canPromote: true,
    });
  });
});

describe("canApproveAsOwner", () => {
  it("permite que admin cubra aprovacao owner em documento de outro setor quando dual approval esta habilitado", async () => {
    await expect(
      canApproveAsOwner(
        {
          sector: "desktop",
          topic: "seguranca",
          owner: "owner@cidadela.local",
        },
        {
          id: "admin-1",
          email: "admin@cidadela.local",
          role: "admin",
          sector: "desenvolvimento",
        },
      ),
    ).resolves.toBe(true);
  });
});
