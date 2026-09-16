import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { defineConfig } from 'prisma/config'

loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production')

// Migrations must not run through a pooled (PgBouncer transaction-mode)
// connection — Prisma's migration engine takes a session-scoped advisory
// lock, which a transaction-mode pooler is not guaranteed to route to the
// same backend connection across statements. This `url` is read only by
// the Prisma CLI (migrate/db push/studio) — the app's runtime queries go
// through lib/prisma.ts, which reads DATABASE_URL independently and is
// unaffected by this file. See docs/knowledge/prisma-direct-vs-pooled-connection.md.
//
// Vercel's DATABASE_URL is the pooled Neon endpoint, so migrations there
// need a separate direct (unpooled) URL: DIRECT_URL. GCP Cloud Run and
// local/CI already connect directly (no pooler in front of DATABASE_URL),
// so DIRECT_URL is unnecessary — and must stay unnecessary — there.
//
// Vercel sets VERCEL=1 automatically at build and runtime (documented
// system env var: https://vercel.com/docs/environment-variables/system-environment-variables).
// Require DIRECT_URL only on that one platform; everywhere else falls back
// to DATABASE_URL exactly as before this change.
const directMigrationUrl = process.env.DIRECT_URL

if (process.env.VERCEL && !directMigrationUrl) {
  throw new Error(
    '[prisma.config.ts] DIRECT_URL is not set. On Vercel, DATABASE_URL is a ' +
    'pooled connection and migrations must not run through it. Set DIRECT_URL ' +
    'to the unpooled Neon connection string in the Vercel project settings ' +
    '(see docs/knowledge/prisma-direct-vs-pooled-connection.md).'
  )
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: directMigrationUrl || process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
})
