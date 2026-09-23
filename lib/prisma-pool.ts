/**
 * Resolve the per-adapter connection pool cap (`pg.PoolConfig.max`) that
 * `lib/prisma.ts` passes to `PrismaPg`/`PrismaNeon`, overridable via the
 * `PRISMA_POOL_MAX` env var. Extracted into its own dependency-free module
 * (mirroring `lib/db-url.ts`) so it can be unit-tested without importing
 * `lib/prisma.ts` itself, which pulls in `@/app/generated/prisma/client` —
 * a file that only exists after `generate-code` has run, and is therefore
 * unavailable at the `test:vitest` gate step (which runs before
 * `generate-code` in the Completion gate order).
 *
 * Unset, malformed, non-positive, or non-finite input all fall back to the
 * default (5), sized for the common case: a pooled endpoint (Neon's
 * `-pooler` connection string, Prisma Postgres, PgBouncer, RDS Proxy) in
 * front of Postgres, not a direct/unpooled instance. **A direct connection
 * (e.g. Cloud SQL) must set `PRISMA_POOL_MAX=2` explicitly** — see the
 * `max: 2` exception-case rationale comment beside the `PrismaPg`
 * direct-connection adapter construction site in `lib/prisma.ts`, and
 * `docs/knowledge/prisma-pool-max-tuning.md` for the full derivation of
 * both the pooled default and the direct-connection exception.
 */
export function resolvePrismaPoolMax(
  rawValue: string | undefined,
  defaultValue: number = 5,
): number {
  const parsed = parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}
