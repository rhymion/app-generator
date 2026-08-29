# Business Date Mechanism Design

This document records the design for a "business date" mechanism: a per-organization notion of
"today" that scheduled batch jobs can use, distinct from the wall-clock `new Date()` value read at
request time. It covers premise verification, the existing-code survey that motivated the design,
storage, the single read function, the admin UI, batch integration, audit, and a soundness check of
the recommended hybrid (auto + manual pin) approach. Three open decisions are handed back to the
project owner at the end — they are presented as options, not settled here.

---

## Premise mismatch: Vercel serverless has no persistent process

The original framing for this mechanism assumed an "at app startup" moment and a scenario where
"the app keeps running continuously" — i.e., that some in-memory value computed once at startup
could represent "today" for as long as the process stays up.

This assumption does not hold for the actual deployment target. The consumer apps run on Vercel as
serverless functions. `app/api/scheduled-tasks/[task]/route.ts` contains a comment noting "Vercel
Cron always invokes with GET" — confirming there is no long-lived process and therefore no
persistent in-memory state to anchor an "as of startup" business date to. Every invocation is a
fresh, stateless function call.

This is addressed head-on rather than reinterpreted: any design that relies on "compute once at
startup, keep in memory" is not viable on this platform. The design below instead stores the
business date in the database and recomputes it (or reads a pinned override) on every read.

## Premise verification (independent confirmation)

Four premises were independently re-verified against the actual code, all confirmed:

1. **`setting` is not a general app-settings table.** `json_schema.yaml:192` declares
   `allOf: [$ref: user]` with `x-self-only` — `setting` is a per-user proxy view, not a place to
   store organization-wide configuration. A new table is required for business-date storage.
2. **Scheduled-task infrastructure already exists and can be reused.** Confirmed by reading three
   files: `lib/scheduled-tasks/system-actor.ts` (`SCHEDULED_TASK_ACTOR_EMAIL` /
   `SCHEDULED_TASK_ROLE_NAME`), `lib/api-auth.ts` (`requireDualAuth` / `requireScheduledTaskRole`),
   and `app/api/scheduled-tasks/[task]/route.ts` (`CRON_SECRET` + `requireScheduledTaskRole`
   dual-auth). The design builds on this existing scaffolding rather than introducing a parallel
   mechanism.
3. **No general-purpose timezone mechanism exists (confirmed with a nuance).** Grepping `lib/` for
   `timeZone`/`TIMEZONE`/`TZ` returns zero hits. One exception was found on inspection:
   `lib/shift_template/copy-shifts.ts` uses `dayjs.tz`, but this is a hand-written function specific
   to shift scheduling, not a general timezone mechanism. The conclusion that "no general-purpose TZ
   mechanism exists" stands.
4. **The serverless-process premise mismatch above is confirmed**, based on the same
   `app/api/scheduled-tasks/[task]/route.ts` comment cited above.

## Survey of existing `new Date()` usage

An inventory of all existing `new Date()` call sites was taken to determine whether any of them
need to be replaced by the new business-date mechanism:

- `lib/`: 12 call sites across 9 files — `audit-log`, `approved_at`, `self_only`, `notifier`,
  `create-user`, `mfa`, `anonymize`, `location`, `asset`. All use the real wall-clock time and are
  semantically correct as-is (e.g., audit timestamps, MFA expiry).
- `templates/`: 4 call sites — an `expires_at` comparison, an export filename, and
  invalidate/anonymize-user logic. All also use real wall-clock time correctly.

**Conclusion: 0 replacements needed.** No existing code should be changed. The business-date
mechanism is additive — it is wired into batch handlers only, as new code.

## Storage design

A new base-schema model (not a generated entity) holds the business-date state:

```prisma
model app_setting {
  id            String   @id @default(cuid())
  org_id        String   @unique
  business_date String
  is_pinned     Boolean  @default(false)
  timezone      String   @default("UTC")
  created_at    DateTime @default(now()) @db.Timestamptz(0)
  updated_at    DateTime @updatedAt @db.Timestamptz(0)
  updater_id    String
  updater       user     @relation(fields: [updater_id], references: [id])
  organization  organization @relation(fields: [org_id], references: [id])
  @@index([org_id])
}
```

- **Scope**: per-organization (one row per org). Pending decision D2 below.
- **Seed baseline**: one row upserted per organization, with `is_pinned: false` and
  `timezone: 'UTC'`.

## Single read function

- **Name**: `getBusinessDate()`
- **Location**: `lib/business-date.ts`
- **Sync target**: all consumer apps, following the same distribution pattern as
  `lib/site-config.ts`.

Logic:

```
is_pinned = true  → return the stored business_date value as-is
is_pinned = false → return new Date().toLocaleDateString('en-CA', { timeZone: setting.timezone })
```

The `'en-CA'` locale is used specifically because it guarantees `YYYY-MM-DD` output format.

This is serverless-safe: there is no shared state between invocations, and the value is
recomputed on every call.

**Batch rule**: a batch job calls `getBusinessDate()` exactly once, at the start of its run, and
propagates the resulting value as an argument to everything it calls. It must not call
`getBusinessDate()` again partway through a run.

## Admin UI

- **API route**: `app/api/app-setting/route.ts` (hand-written, singleton resource)
- **Page**: `app/app-setting/page.tsx` (hand-written)
- **GET**: readable by any authenticated member of the organization
- **PUT**: restricted to the Administrator role (enforced in the route handler)
- **Pinned warning**: when `is_pinned = true`, the admin page displays a prominent warning banner:
  *"Business date is manually pinned to {date}. Pinned {N} days ago."* This is the primary
  safeguard against the operational risk of a pin being forgotten.

## Batch integration

- **Scheduled-task route flow**: resolve `org_id` → read `app_setting` → call `getBusinessDate()`
  once → pass the result into `run()`.
- **`run()` signature**: `run(systemActorId: string, businessDate: string): Promise<void>`
- **Handler signature**: `handle{PascalName}(tx, id, systemActorId, businessDate: string)`
- **Templates to modify**:
  - `service_scheduled.ts.jinja2`
  - `service_scheduled_handler.ts.jinja2`
  - `app/api/scheduled-tasks/[task]/route.ts`

## Audit

- **Minimal**: `updater_id` + `updated_at` columns on `app_setting` (already included in the schema
  above).
- **Full history**: extending `AuditLog` to append a row on every `PUT` is a further option, whose
  adoption is pending the project owner's decision on D1 below.

## Hybrid design soundness check

The recommended design is hybrid: the business date advances automatically by timezone by default,
and an administrator can pin it to a fixed value, then unpin to resume automatic advancement. This
was checked for ways it could break:

1. **Vercel serverless constraint**: the value is recomputed on every read, so no shared state is
   required across invocations. No issue found.
2. **Split-brain risk**: every function reads the same `app_setting` row from the database. No issue
   found.
3. **Risk of forgetting a pin**: mitigated (not eliminated) by the admin-page warning banner
   ("Pinned N days ago").
4. **Overnight batch crossing a date boundary**: the batch reads the business date once at the start
   of its run and does not recompute mid-run. No issue found.
5. **Comparison to manual-only**: a manual-only design (Option B under D3 below) would require either
   a daily manual operation or a separate midnight cron job to advance the date.

**Verdict: no way found for the hybrid design to break.** It is maintained as the recommendation.

## Generator change scope

New hand-written files to add:

- `prj/prisma/schema.prisma` — add the `app_setting` model
- `scripts/seed-baseline.ts` — add the per-org upsert
- `lib/business-date.ts` — new file
- `app/api/app-setting/route.ts` — new route
- `app/app-setting/page.tsx` — new page

Existing templates to modify:

- `templates/service_scheduled.ts.jinja2` — extend the `run()` signature
- `templates/service_scheduled_handler.ts.jinja2` — add the `businessDate` parameter
- `app/api/scheduled-tasks/[task]/route.ts` — resolve and propagate `businessDate`

No new schema key and no new fixture entity are required.

## Decisions for the project owner

The following three decisions are presented as options for the project owner to choose between.
None of them has been decided by this design — a recommendation is noted for each, but it is a
recommendation only.

### D1: Scope

- **Option A**: Batch only — only `x-scheduled-task` handlers receive `businessDate`. Existing
  `new Date()` call sites are left unchanged.
- **Option B**: General business logic — filters, default values, reports, etc. are also unified
  onto `getBusinessDate()` for "today".
- **Recommendation**: A (batch only) — keep the initial scope minimal and expand later once it is
  confirmed to work.

### D2: Granularity

- **Option A**: Per organization — one row per org. Preserves strict organization isolation.
- **Option B**: One row for the whole app — simpler, but breaks organization isolation.
- **Recommendation**: A (per organization) — consistent with the existing strict org-isolation
  policy.

### D3: Automatic vs. manual

- **Option A**: Hybrid — advances automatically by timezone by default; an administrator can pin it
  to override, and unpinning resumes automatic advancement.
- **Option B**: Manual-only, as originally envisioned — the date does not change without a manual
  operation. Requires either a daily manual step or a separately added midnight cron job.
- **Recommendation**: A (hybrid) — zero ongoing operational burden, while still allowing a manual
  override. If B is chosen instead, a midnight cron job must be added separately.

## Out of scope

- Per-user timezone (this design is per-organization)
- Customizing the "end of business day" cutoff time (only midnight-in-timezone is supported)
- Retaining a full change history (an `AuditLog` extension is contingent on the D1 decision)
- The insurance-app project (`proj_h`) — held out of scope per an earlier decision to leave that project untouched
