import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { appConfig } from "@/lib/config";
import { findUserByEmail } from "@/lib/db/users-repo";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: appConfig.authSecret,
  trustHost: appConfig.authTrustHost,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      authorize: async (rawCredentials) => {
        const credentials = credentialsSchema.safeParse(rawCredentials);
        if (!credentials.success) {
          return null;
        }

        const user = await findUserByEmail(credentials.data.email);
        if (!user) {
          return null;
        }

        const passwordMatches = await bcrypt.compare(
          credentials.data.password,
          user.passwordHash,
        );
        if (!passwordMatches) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          sector: user.sector,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    authorized({ auth: session, request }) {
      const isLoggedIn = Boolean(session?.user);
      const { pathname } = request.nextUrl;

      if (pathname.startsWith("/api/auth")) {
        return true;
      }

      if (pathname === "/login") {
        return !isLoggedIn;
      }

      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.sector = user.sector;
        token.role = user.role;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id =
          typeof token.userId === "string" ? token.userId : "";
        session.user.sector =
          token.sector === "seguranca" ||
          token.sector === "suporte" ||
          token.sector === "desenvolvimento" ||
          token.sector === "desktop"
            ? token.sector
            : "desenvolvimento";
        session.user.role = token.role === "admin" ? "admin" : "user";
      }

      return session;
    },
  },
});
