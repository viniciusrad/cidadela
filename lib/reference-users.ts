import referenceUsers from "../prisma/seed-data/reference-users.json";

import { SECTORS, USER_ROLES, type ReferenceUser } from "@/lib/domain";

function assertReferenceUser(value: unknown): asserts value is ReferenceUser {
  if (!value || typeof value !== "object") {
    throw new Error("Usuario de referencia invalido.");
  }

  const user = value as Record<string, unknown>;
  if (typeof user.email !== "string" || !user.email.includes("@")) {
    throw new Error("Email de usuario de referencia invalido.");
  }

  if (typeof user.password !== "string" || user.password.length < 6) {
    throw new Error(`Senha invalida para ${String(user.email ?? "usuario")}.`);
  }

  if (typeof user.name !== "string" || user.name.trim().length === 0) {
    throw new Error(`Nome invalido para ${String(user.email ?? "usuario")}.`);
  }

  if (!SECTORS.includes(user.sector as ReferenceUser["sector"])) {
    throw new Error(`Setor invalido para ${String(user.email ?? "usuario")}.`);
  }

  if (!USER_ROLES.includes(user.role as ReferenceUser["role"])) {
    throw new Error(`Role invalida para ${String(user.email ?? "usuario")}.`);
  }
}

export function getReferenceUsers() {
  const emails = new Set<string>();

  return referenceUsers.map((entry) => {
    assertReferenceUser(entry);

    if (emails.has(entry.email)) {
      throw new Error(`Email duplicado no arquivo de referencia: ${entry.email}`);
    }

    emails.add(entry.email);
    return entry;
  });
}
