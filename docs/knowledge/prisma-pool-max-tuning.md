# Tuning `PRISMA_POOL_MAX` (per-adapter connection pool cap)

## What this controls

`lib/prisma.ts` constructs its `PrismaPg`/`PrismaNeon` adapter with a `max`
option (the underlying `pg.Pool`'s connection cap for *this one process*).
Before this env var existed, `max` was hardcoded to `2` at both adapter
construction sites, sized for one specific deployment shape: Cloud Run
talking to a Postgres instance directly (no pooler in front of it), where
every one of `max-instances` Cloud Run instances holds its own real backend
connection open — see the `rca_267a §6, Option A` comment beside the
`PrismaPg` adapter for the calculation that produced `2`.

`PRISMA_POOL_MAX` lets a deployment override that cap without a code change.
**Unset, the default stays `2`** — behavior for the direct-connection
deployment shape this default was calibrated for does not change.

## When to raise it, and by how much

Only raise this when the URL `lib/prisma.ts` connects to is a **pooler**
(PgBouncer, Neon's pooled `-pooler` endpoint, RDS Proxy, etc.), not a raw
instance. A pooler multiplexes many client-side connections (from this
process's `pg.Pool`) down to a smaller, bounded number of real backend
connections to Postgres itself — so this process can safely hold more
client-side connections open than the database's own `max_connections`
would otherwise allow, *up to the pooler's own configured or plan-based
backend connection limit*.

**The rule, mirroring the existing Cloud SQL calculation this file's `max: 2`
comment already uses**:

```
(Cloud Run max-instances) × PRISMA_POOL_MAX  <  pooler's backend connection limit
```

leaving headroom for admin/migration connections (`DIRECT_URL`'s own
connection, `prisma migrate deploy`, etc.), exactly as the existing Cloud SQL
comment already does for its own `20 < 25` case.

**This repo cannot hardcode a single recommended number for the pooled
case**, because a pooler's real backend connection limit is a property of
*your* Neon project (its compute size/plan — this scales with compute, and
differs across Neon's plan tiers) or *your* PgBouncer's own `pool_size`/
`max_client_conn` configuration, not a constant this codebase controls.
Check that limit for your own provisioned pooler before picking a value, and
apply the inequality above. **Recommendation, not a rule: "raise it because
the pooler makes it safe" is not itself the justification — write down the
actual instance-count × PRISMA_POOL_MAX arithmetic against the pooler's real
limit**, the same way the existing Cloud SQL comment does, so a later reader
(or a later Cloud Run `max-instances` change) can re-check the inequality
still holds.

## Where this is set

`.env.production.local` (per-project, not committed — see
`docs/knowledge/gcp-automation-design.md`). Not required for local dev/CI,
which run a single Next.js process against a local Postgres container with
no instance fan-out to size for.
