import { config as loadEnv } from "dotenv";

import { defineConfig, env } from "prisma/config";

// Mesma precedencia usada por prisma/seed.ts: .env.local (ambiente de
// desenvolvimento, ignorado pelo git) tem prioridade sobre .env. O `dotenv/config`
// padrao le apenas .env, o que deixava o `prisma migrate`/`generate` sem
// DATABASE_URL em quem seguiu o setup do README (que cria .env.local).
loadEnv({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --env-file-if-exists=.env.local --env-file-if-exists=.env prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
