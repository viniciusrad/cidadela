import type { Sector, UserRole } from "@/lib/domain";

declare module "next-auth" {
  interface User {
    id: string;
    sector: Sector;
    role: UserRole;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      sector: Sector;
      role: UserRole;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    sector?: Sector;
    role?: UserRole;
  }
}
