# Upgrade Guide — 3.0

3.0 consolidates the feature areas added since 2.0.0: GCP Cloud Run
deployment, an audit log viewer, GDPR/data-protection tooling, attachment
display opt-out, a round of performance hardening, notification persistence,
`nativeEnum` type safety on 6 previously-`Int` fields, and organization-
isolation enforcement. It ships as a major bump because the performance,
data-protection, enum-type-safety, and organization-isolation work include
breaking changes.

> The repository ships **no migration files** — schema is applied with
> `prisma db push` (see `db:push`). Fresh installs always start from the
> current schema, so committing version-pinned migrations would be wrong for
> new users. This guide is the migration record instead; it lives in `docs/`,
> **not** under `prisma/migrations/`. Four schema changes in 3.0
> (`user.anonymized_at`, the `audit_log.actor_user` foreign key, the 6
> `nativeEnum` column conversions, and the new `notification` table) still
> need `prisma db push` or `prisma migrate deploy` (plus explicit `ALTER
> TABLE` for the enum columns — see below) run against existing databases.

---

## Breaking changes folded into 3.0

Four of the seven breaking changes in 3.0 are schema dependencies; the other
three are runtime/API behavior changes with no schema impact. Both categories
are covered below.

### Schema dependency

| Introduced | Component | Change | Symptom on older schema |
|---|---|---|---|
| 3.0 | Data protection/GDPR (`anonymizeUser()`, `lib/compliance/anonymize_user.ts`) | New nullable `user.anonymized_at` column (assumed but not provisioned) | `prisma.user.anonymized_at` does not exist → TS build fails |
| 3.0 | Audit log (`prisma/schema.prisma`, commit `ec2cbb8`) | New `audit_log.actor_user` relation, `onDelete: Restrict` FK to `user.id` | `prisma db push`/`migrate deploy` fails if any `audit_log.actor_user_id` references a since-deleted user (orphaned row) |
| 3.0 | Enum type safety (`nativeEnum` promotion, cmd457) | 6 previously-`Int` enum columns promoted to Prisma `nativeEnum`: `approval_request.status`, `reaction.type`, `attachment.type`, `dashboard_widget.chart_type`, `dashboard_widget.stack_mode`, `dashboard_widget.group_by_bucket` | Plain `prisma db push --accept-data-loss` drops and recreates each column, silently overwriting **every existing row** to the enum's default value (or to `NULL`/failure for columns without one) — confirmed by isolated-DB testing (see below). Requires the explicit `ALTER TABLE ... USING` migration path, not plain `db push`. |
| 3.0 | Notification persistence (`prisma/schema.prisma`, `notification` model) | New `notification` table (replaces the in-memory SSE store) | `GET /api/notifications` and `POST /api/notifications/mark-read` throw `P2021` ("table does not exist") → `500` for every logged-in user (the bell icon is on the shared header, so this is not limited to approval-flow users); notification *writes* fail silently instead (swallowed in `lib/_notifier.ts`'s fire-and-forget `notify()`) |

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

The `nativeEnum` case is the most severe of the four: unlike the other three,
a plain `db push`/`migrate deploy` does not merely fail loudly — it
*succeeds* while silently corrupting data (approved/rejected
`approval_request` rows observed reverting to `pending` with no error, in
isolated-DB testing on `approval_request.status`). It requires an explicit
`ALTER TABLE ... ALTER COLUMN ... TYPE ... USING (CASE ...)` per column,
run **before** `db push`, to convert in place without a drop/recreate — see
the upgrade steps below. The `notification` table, by contrast, is purely
additive (a brand-new table) and is safely created by a plain `db push`; its
risk is entirely on the *read* side (the table not existing yet), not on
data loss.

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
- **Organization-scoped mutation paths now deny cross-org access (cmd452)** —
  generated API routes and server actions for org-scoped entities previously
  authorized update/delete/CSV-import-update purely via
  `creator_id`/`assignee_id` (`resolvePermissions()`), without checking
  organization membership, so a user holding `general.update` /
  `general.delete` / `general.import` could act on another organization's
  record by ID (IDOR). 3.0 adds an explicit organization-membership check on
  these mutation paths: a cross-organization request now resolves to a deny
  (API routes return `404`; session-action paths no-op silently) instead of
  succeeding. No schema change — this only bites a deployment whose client or
  test code depended on the old (permissive) cross-org behavior.
- **`db:seed-tenant` requires `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` under
  `NODE_ENV=production`** — every production-equivalent
  provisioning path (`vercel-build`, `build:full`, GCP's `gcp-seed.sh`) now
  fails fast at seed time unless both env vars are set, instead of silently
  seeding the well-known `admin@example.com`/`password123` default and a
  fixed `api_key` literal. Set both before your next production provisioning
  run; `api_key` is generated automatically and printed once to stdout. If a
  deployment was already provisioned with the old defaults, see
  [docs/knowledge/seed-tenant-credential-hardening.md](docs/knowledge/seed-tenant-credential-hardening.md)
  for the remediation runbook (rotate password/api_key, or create a fresh
  admin and disable the default one). `test`/`development` provisioning is
  unaffected.

---

## What 3.0 adds to the schema

```prisma
// added to model user:
//   anonymized_at  DateTime?  // Timestamp when PII was scrubbed (GDPR anonymization)
//   audit_logs     audit_log[]

// added to model audit_log:
//   actor_user  user?  @relation(fields: [actor_user_id], references: [id], onDelete: Restrict)

// new enums (nativeEnum promotion — these columns were plain Int before 3.0):
enum ApprovalRequestStatus { pending approved rejected terminal_rejected }
enum ReactionType { Like Love Laugh Surprised Sad }
enum AttachmentType { image file video audio }
enum DashboardWidgetChartType { pie column bar line }
enum DashboardWidgetStackMode { grouped stacked standardized }
enum DashboardWidgetGroupByBucket { day week month quarter year }

// changed on model approval_request:
//   status  ApprovalRequestStatus  @default(pending)        // was: Int
// changed on model reaction:
//   type    ReactionType                                    // was: Int, no default
// changed on model attachment:
//   type    AttachmentType  @default(image)                 // was: Int
// changed on model dashboard_widget:
//   chart_type       DashboardWidgetChartType   @default(column)  // was: Int
//   stack_mode       DashboardWidgetStackMode?                     // was: Int?
//   group_by_bucket  DashboardWidgetGroupByBucket?                 // was: Int?

// added model notification:
model notification {
  id         String   @id @default(cuid())
  user_id    String
  user       user     @relation("NotificationUser", fields: [user_id], references: [id], onDelete: Cascade)
  type       String
  payload    Json
  read       Boolean  @default(false)
  created_at DateTime @default(now()) @db.Timestamptz(0)

  @@index([user_id, read])
  @@index([user_id, created_at(sort: Desc)])
}
```

The `audit_log` model's core columns (id/actor_user_id/action/target_table/
target_id/metadata/created_at) predate 2.0.0, but the `actor_user` relation
and its FK constraint are new in 3.0. The viewer page
(`app/[locale]/audit_log/page.tsx`) is built on top of that relation.

The `notification` table is entirely new (no predating columns). Enum
member names, order, and per-field defaults above were confirmed directly
against `prisma/schema.prisma` and the `cmd457` commits that introduced them
— not reconstructed from memory.

---

## Fresh install (3.0 from scratch)

Nothing special — no pre-existing data means no orphaned `actor_user_id`
values, and no rows to corrupt when the enum columns are created directly in
their final (nativeEnum) type:

```bash
prisma db push      # creates user.anonymized_at, the audit_log FK, the 6
                     # nativeEnum columns, and the notification table
prisma generate
```

---

## Upgrade an existing 1.0–2.0 deployment → 3.0

`user.anonymized_at` and the `notification` table are purely **additive**.
The `audit_log.actor_user` FK is not purely additive — `db push`/`migrate
deploy` will fail if any existing `audit_log.actor_user_id` value references
a `user` row that no longer exists, since the pre-3.0 schema had no
constraint stopping that. The 6 `nativeEnum` columns are **not** additive and
must **not** be left to a plain `db push` — see step 4.

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

# 4. Convert the 6 nativeEnum columns BEFORE running `db push`. A plain
#    `db push --accept-data-loss` drops and recreates these columns,
#    silently overwriting every existing row to the enum's default (or
#    failing/nulling columns with no default) — confirmed by isolated-DB
#    testing on all 6 fields. Running the explicit ALTER TABLE below first
#    makes Prisma see the columns as already matching, so the `db push` in
#    step 5 reports no diff for them.
#
#    Field with no default (reaction.type): verify there are no
#    out-of-range values before running its ALTER TABLE, since the CASE
#    below intentionally has no ELSE branch (an unmapped value would
#    otherwise be silently coerced instead of stopping the migration):
psql "$DATABASE_URL" -c \
  'SELECT DISTINCT type FROM reaction WHERE type NOT IN (0,1,2,3,4);'
#    (must return zero rows before proceeding)

psql "$DATABASE_URL" <<'SQL'
-- 1. approval_request.status (NOT NULL, @default(pending))
--    pending(0) / approved(1) / rejected(2) / terminal_rejected(new, no old value maps to it)
--    DROP DEFAULT first: Postgres tries to auto-cast the existing Int
--    default (0) to the new enum type as part of ALTER COLUMN ... TYPE,
--    and that automatic cast fails (confirmed by isolated-DB testing) —
--    drop it, convert the column, then set the new (enum-typed) default.
ALTER TABLE approval_request
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE approval_request
  ALTER COLUMN status TYPE "ApprovalRequestStatus"
  USING (CASE status
    WHEN 0 THEN 'pending'
    WHEN 1 THEN 'approved'
    WHEN 2 THEN 'rejected'
    ELSE 'pending'  -- safety net for unexpected values; adjust if pending is not the desired fallback
  END)::"ApprovalRequestStatus";
ALTER TABLE approval_request
  ALTER COLUMN status SET DEFAULT 'pending';

-- 2. attachment.type (NOT NULL, @default(image)) — same DROP DEFAULT need
--    image(0) / file(1) / video(2) / audio(3) — value set and order unchanged
ALTER TABLE attachment
  ALTER COLUMN type DROP DEFAULT;
ALTER TABLE attachment
  ALTER COLUMN type TYPE "AttachmentType"
  USING (CASE type
    WHEN 0 THEN 'image' WHEN 1 THEN 'file'
    WHEN 2 THEN 'video' WHEN 3 THEN 'audio'
    ELSE 'image'
  END)::"AttachmentType";
ALTER TABLE attachment
  ALTER COLUMN type SET DEFAULT 'image';

-- 3. reaction.type (NOT NULL, no default — no DROP DEFAULT needed)
--    Like(0) / Love(1) / Laugh(2) / Surprised(3) / Sad(4)
--    No ELSE branch on purpose — an unmapped value should stop the
--    migration rather than be silently coerced. Verified zero out-of-range
--    rows above before running this.
ALTER TABLE reaction
  ALTER COLUMN type TYPE "ReactionType"
  USING (CASE type
    WHEN 0 THEN 'Like' WHEN 1 THEN 'Love' WHEN 2 THEN 'Laugh'
    WHEN 3 THEN 'Surprised' WHEN 4 THEN 'Sad'
  END)::"ReactionType";

-- 4. dashboard_widget.chart_type (NOT NULL, @default(column)) — DROP DEFAULT needed
--    pie(0) / column(1) / bar(2) / line(3) — old default (1=column) unchanged in meaning
ALTER TABLE dashboard_widget
  ALTER COLUMN chart_type DROP DEFAULT;
ALTER TABLE dashboard_widget
  ALTER COLUMN chart_type TYPE "DashboardWidgetChartType"
  USING (CASE chart_type
    WHEN 0 THEN 'pie' WHEN 1 THEN 'column'
    WHEN 2 THEN 'bar' WHEN 3 THEN 'line'
    ELSE 'column'
  END)::"DashboardWidgetChartType";
ALTER TABLE dashboard_widget
  ALTER COLUMN chart_type SET DEFAULT 'column';

-- 5. dashboard_widget.stack_mode (nullable, no default)
--    grouped(0) / stacked(1) / standardized(2)
--    NULL passes through the CASE untouched (NULL in -> NULL out)
ALTER TABLE dashboard_widget
  ALTER COLUMN stack_mode TYPE "DashboardWidgetStackMode"
  USING (CASE stack_mode
    WHEN 0 THEN 'grouped' WHEN 1 THEN 'stacked' WHEN 2 THEN 'standardized'
  END)::"DashboardWidgetStackMode";

-- 6. dashboard_widget.group_by_bucket (nullable, no default)
--    day(0) / week(1) / month(2) / quarter(3) / year(4)
ALTER TABLE dashboard_widget
  ALTER COLUMN group_by_bucket TYPE "DashboardWidgetGroupByBucket"
  USING (CASE group_by_bucket
    WHEN 0 THEN 'day' WHEN 1 THEN 'week' WHEN 2 THEN 'month'
    WHEN 3 THEN 'quarter' WHEN 4 THEN 'year'
  END)::"DashboardWidgetGroupByBucket";
SQL

# 5. Apply the remaining schema changes: new nullable anonymized_at column,
#    new audit_log FK constraint, and the new notification table (purely
#    additive — no data-loss risk). The 6 enum columns converted in step 4
#    now match the target schema exactly, so db push reports no diff for
#    them.
prisma db push

# 6. No backfill needed for anonymized_at. It is nullable and stays NULL
#    until a user is explicitly anonymized via anonymizeUser() — there is no
#    historical-data equivalent to backfill, unlike 2.0's approved_at.

# 7. Review the behavior changes above (statement_timeout, pageSize
#    validation, organization-scoped mutation enforcement) against your
#    deployment before restarting:
#    - If you rely on queries longer than 30s on the direct-connection path,
#      set STATEMENT_TIMEOUT_MS to a higher value or 0.
#    - If any API client sends pageSize > 200, update it first.
#    - If any client or test depends on a user being able to update/delete/
#      CSV-import-update another organization's record by ID, that access is
#      now denied (404 / silent no-op) — update the client or its
#      permissions/org-membership expectations.
#    Also note: deleting a `user` with existing `audit_log` rows will now be
#    rejected (`onDelete: Restrict`) instead of silently orphaning them; and
#    until step 5 completes, notification reads (bell icon, GET
#    /api/notifications) return 500 for every logged-in user, while
#    notification writes fail silently — prioritize this migration path on a
#    live deployment with active users.

# 8. Restart the app.
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

The 6 `nativeEnum` columns have no `db push`-avoiding alternative beyond what
is already explicit DDL — the `ALTER TABLE ... USING` statements in step 4 of
the upgrade section above **are** the raw SQL; run them exactly as shown,
independent of whether `db push` is used for the rest of the schema.

The `notification` table has no hand-written DDL in this guide (per this
repository's "no migration files" policy above, an inline `CREATE TABLE` for
a Prisma-managed model would need to be kept in lockstep with
`prisma/schema.prisma` by hand). Because it is purely additive and new, it
carries none of the FK-orphan or data-loss risk the other schema changes do
— routing just this one table through `prisma db push` is safe even for
operators who apply everything else as explicit DDL.

---

## Rollback

`anonymized_at` and `notification` are additive and unused by pre-3.0 code,
so a pre-3.0 app can run against a 3.0-migrated database unchanged (aside
from the `audit_log` FK and the `nativeEnum` columns below). To roll the
schema back:

```bash
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_user_id_fkey";
ALTER TABLE "user" DROP COLUMN "anonymized_at";
DROP TABLE "notification";

-- nativeEnum columns: convert back to Int (reverse of the step-4 CASE
-- mapping above; e.g. approval_request.status). DROP DEFAULT first for
-- columns that have one (status, attachment.type, chart_type) — same
-- "default cannot be cast automatically" restriction as the forward
-- conversion, confirmed by isolated-DB testing in both directions:
ALTER TABLE approval_request
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE approval_request
  ALTER COLUMN status TYPE INTEGER
  USING (CASE status
    WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2
    ELSE 0  -- terminal_rejected has no pre-3.0 equivalent
  END);
ALTER TABLE approval_request
  ALTER COLUMN status SET DEFAULT 0;
-- repeat the same pattern (enum label -> old int index, DROP DEFAULT first
-- where one exists) for the other 5 columns, using the mappings documented
-- in step 4 above, in reverse.
```

The `statement_timeout`, `pageSize`, and organization-scoped-mutation
behavior changes are code-only — reverting the app code reverts the
behavior; no data is affected either way.
