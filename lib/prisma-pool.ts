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
 * pre-existing hardcoded default (2) — see the `max: 2` rationale comments
 * at each adapter construction site in `lib/prisma.ts` for why 2 is correct
 * there, and `docs/knowledge/prisma-pool-max-tuning.md` for when/how to
 * raise it via this env var.
 */
export function resolvePrismaPoolMax(
  rawValue: string | undefined,
  defaultValue: number = 2,
): number {
  const parsed = parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}
