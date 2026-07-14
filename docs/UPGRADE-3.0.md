# Upgrade Guide — 3.0

3.0 consolidates five feature areas added since 2.0.0: GCP Cloud Run
deployment, an audit log viewer, GDPR/data-protection tooling, attachment
display opt-out, and a round of performance hardening. It ships as a major
bump because the performance and data-protection work include breaking
changes.

> The repository ships **no migration files** — schema is applied with
> `prisma db push` (see `db:push`). Fresh installs always start from the
> current schema, so committing version-pinned migrations would be wrong for
> new users. This guide is the migration record instead; it lives in `docs/`,
> **not** under `prisma/migrations/`. Two schema changes in 3.0
> (`user.anonymized_at` and the `audit_log.actor_user` foreign key) still
> need `prisma db push` or `prisma migrate deploy` run against existing
> databases — see below.

---

## Breaking changes folded into 3.0

Two of the four breaking changes in 3.0 are schema dependencies; the other
two are runtime/API behavior changes with no schema impact. Both categories
are covered below.

### Schema dependency

| Introduced | Component | Change | Symptom on older schema |
|---|---|---|---|
| 3.0 | Data protection/GDPR (`anonymizeUser()`, `lib/compliance/anonymize_user.ts`) | New nullable `user.anonymized_at` column (assumed but not provisioned) | `prisma.user.anonymized_at` does not exist → TS build fails |
| 3.0 | Audit log (`prisma/schema.prisma`, commit `ec2cbb8`) | New `audit_log.actor_user` relation, `onDelete: Restrict` FK to `user.id` | `prisma db push`/`migrate deploy` fails if any `audit_log.actor_user_id` references a since-deleted user (orphaned row) |

The `anonymized_at` case has the same root cause as the 2.0 breaking changes:
static (non-generated) infrastructure takes an unconditional dependency on a
new column that the generator does not emit for schemas that predate it. The
`audit_log` FK is different: the `audit_log` model's columns predate 2.0.0,
but the relation (and its `onDelete: Restrict` constraint) was added
afterward, in `ec2cbb8` ("fix: Show audit log page", 2026-06-26) — confirmed
absent at the `v2.0.0` tag via `git show v2.0.0:prisma/schema.prisma`. Adding
this FK to an existing database can fail outright if orphaned
`actor_user_id` values exist, and afterward it also changes runtime
behavior: deleting a `user` with existing `audit_log` rows is rejected
instead of silently orphaning them.

### Behavior changes (no schema impact)

These do not require a schema change — they change what already-generated
code does at runtime, so they only bite when you upgrade the generator/app
code without changing anything in the database:

- **`statement_timeout` now enforced by default** — `lib/prisma.ts` applies a
  30-second `statement_timeout` on the direct (PrismaPg) connection path.
  Queries that previously ran unbounded (large exports, complex reports) will
  now fail with a timeout error past 30s. Set `STATEMENT_TIMEOUT_MS` to a
  higher value, or `0` to disable. Does not apply to the Accelerate path
  (Vercel's `PRISMA_DATABASE_URL`), which never forwards `statement_timeout`.
- **`pageSize > 200` now returns `400 Bad Request`** — generated REST API
  routes (`code_generator/templates/api_route.ts.jinja2`) previously
  truncated an over-limit `pageSize` to 200 silently; they now reject it.
  Any client sending `pageSize` above `MAX_PAGE_SIZE` (200) must be updated to
  cap the value client-side before it hits a 3.0 deployment.

---

## What 3.0 adds to the schema

```prisma
// added to model user:
//   anonymized_at  DateTime?  // Timestamp when PII was scrubbed (GDPR anonymization)
//   audit_logs     audit_log[]

// added to model audit_log:
//   actor_user  user?  @relation(fields: [actor_user_id], references: [id], onDelete: Restrict)
```

The `audit_log` model's core columns (id/actor_user_id/action/target_table/
target_id/metadata/created_at) predate 2.0.0, but the `actor_user` relation
and its FK constraint are new in 3.0. The viewer page
(`app/[locale]/audit_log/page.tsx`) is built on top of that relation.

---

## Fresh install (3.0 from scratch)

Nothing special — no pre-existing data means no orphaned `actor_user_id`
values to worry about:

```bash
prisma db push      # creates user.anonymized_at and the audit_log FK
prisma generate
```

---

## Upgrade an existing 1.0–2.0 deployment → 3.0

`user.anonymized_at` is a purely **additive** nullable column. The
`audit_log.actor_user` FK is not purely additive — `db push`/`migrate deploy`
will fail if any existing `audit_log.actor_user_id` value references a
`user` row that no longer exists, since the pre-3.0 schema had no constraint
stopping that.

```bash
# 1. Pull 3.0, regenerate the client
prisma generate

# 2. Check for orphaned audit_log rows before applying the schema change.
psql "$DATABASE_URL" -c \
  'SELECT count(*) FROM audit_log WHERE actor_user_id IS NOT NULL
     AND actor_user_id NOT IN (SELECT id FROM "user");'

# 3. If step 2 found orphans, null them out (they predate the FK and have no
#    resolvable actor either way):
psql "$DATABASE_URL" -c \
  'UPDATE audit_log SET actor_user_id = NULL WHERE actor_user_id IS NOT NULL
     AND actor_user_id NOT IN (SELECT id FROM "user");'

# 4. Apply the schema change (new nullable column + new FK constraint).
prisma db push

# 5. No backfill needed for anonymized_at. It is nullable and stays NULL
#    until a user is explicitly anonymized via anonymizeUser() — there is no
#    historical-data equivalent to backfill, unlike 2.0's approved_at.

# 6. Review the two behavior changes above (statement_timeout, pageSize
#    validation) against your deployment before restarting:
#    - If you rely on queries longer than 30s on the direct-connection path,
#      set STATEMENT_TIMEOUT_MS to a higher value or 0.
#    - If any API client sends pageSize > 200, update it first.
#    Also note: deleting a `user` with existing `audit_log` rows will now be
#    rejected (`onDelete: Restrict`) instead of silently orphaning them.

# 7. Restart the app.
```

---

## Alternative: explicit DDL (no `db push`)

For operators who don't want `db push` touching a production database:

```bash
psql "$DATABASE_URL" -c 'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3);'

# Null out orphaned actor_user_id values first (see step 2/3 above), then:
psql "$DATABASE_URL" -c \
  'ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey"
     FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;'
```

---

## Rollback

`anonymized_at` is additive and unused by pre-3.0 code, so a pre-3.0 app can
run against a 3.0-migrated database unchanged (aside from the `audit_log` FK
below). To roll the schema back, drop the `user.anonymized_at` column and the
`audit_log_actor_user_id_fkey` constraint
(`ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_user_id_fkey";`).
The `statement_timeout` and `pageSize` behavior changes are code-only —
reverting the app code reverts the behavior; no data is affected either way.
