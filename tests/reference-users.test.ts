import { describe, expect, it } from "vitest";

import { getReferenceUsers } from "../lib/reference-users";

describe("reference users", () => {
  it("loads a valid unique list of users", () => {
    const users = getReferenceUsers();

    expect(users).toHaveLength(4);
    expect(new Set(users.map((user) => user.email)).size).toBe(users.length);
    expect(users.find((user) => user.email === "dev@pfrm.local")?.sector).toBe(
      "desenvolvimento",
    );
  });
});
