import { prisma } from "@/lib/db/client";

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
  });
}
