// AUTO-GENERATED - DO NOT EDIT
// Next.js instrumentation hook: register() runs once per server instance
// bootstrap, on both Vercel and GCP/Cloud Run (a single wiring point
// reaches both deployment targets, since both dispatch through this same
// Next.js mechanism). Used here to ensure the search GIN indexes exist —
// see lib/db-init.ts. CREATE INDEX CONCURRENTLY IF NOT EXISTS makes this
// non-blocking and a fast no-op after the first successful cold start.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureSearchIndexes } = await import('@/lib/db-init');
    await ensureSearchIndexes().catch((err: unknown) => {
      console.error('ensureSearchIndexes() failed during startup:', err);
    });
  }
}
