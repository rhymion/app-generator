# Operating the x-scheduled-task mechanism (Vercel and GCP)

`x-scheduled-task` declares a recurring, filtered row-scan + per-row handler
call on any entity. Declaring the key in `code_generator/json_schema.yaml`
is not enough by itself for anything to actually run — this doc is the
operational half: what generate.py produces, what has to be true outside
the repo for it to fire, and how to tell whether it's actually firing.

A task can be started three ways, and all three go through one shared
completion-record guard (see "Completion records and the run guard"):

- the generated HTTP route, called by Vercel Cron or any external scheduler;
- `npm run task:run -- <task_id>`, one task, run directly against the database;
- `npm run task:run-all`, every task in `depends_on` order, run directly
  against the database. This is the intended nightly trigger for tasks that
  declare `depends_on` (see "Running tasks directly: `task:run` and
  `task:run-all`").

There is a second, entity-agnostic mode — top-level `x-scheduled-tasks`
(plural) — for operations that don't fit a single-entity filtered row scan.
See "Bulk mode" below; everything else on this page (the route, auth,
`CRON_SECRET`, the system actor, the Vercel/GCP mechanics) applies
identically to both modes, since they share one dispatcher route and one
registry.

## What gets generated

For every entity that declares `x-scheduled-task`:

- `lib/{entity}/service_scheduled.ts` — regenerated every `generate-code` run.
  Selects rows matching the declared filter (`expires_at_before_now` and/or
  `status_in`) and calls the configured handler once per row, each in its own
  transaction.
- `lib/{entity}/service_scheduled_handler.ts` — **GENERATED ONCE** (safe to
  hand-edit). The actual side effect. Ships as a `// TODO` stub; nothing
  happens until this is filled in.

For every top-level `x-scheduled-tasks` (bulk) entry:

- `lib/scheduled-tasks/{task_id}/service_scheduled.ts` — regenerated every
  `generate-code` run. No row selection: calls the configured handler once,
  directly, with the system actor id.
- `lib/scheduled-tasks/{task_id}/service_scheduled_handler.ts` — **GENERATED
  ONCE** (safe to hand-edit). Ships as a `// TODO` stub; nothing happens
  until this is filled in — same write-once contract as the row-scan
  handler stub above, just with a `(systemActorId)` signature instead of
  `(tx, entityId, systemActorId)` (no row/transaction to hand it).

Fixed, task-count-independent (regenerated every run regardless of how many
tasks — either mode — declare a key):

- `lib/scheduled-tasks/registry.ts` — maps every declared `task_id`, from
  either mechanism, to its `run()` function. The registry and the route
  below are unaware which mode produced any given entry.
- `lib/scheduled-tasks/dependencies.ts` — `TASK_DEPENDENCIES` (`task_id` to
  its declared `depends_on` predecessors) and `TASK_INTERVALS` (`task_id` to
  its `interval` cron string, or `null`), in schema declaration order.
- `lib/scheduled-tasks/run-guard.ts` — the completion-record guard every run
  goes through. Without any declared task it is a stub that references no
  table, so the route and scripts still compile.
- the `scheduled_task_run` model and `ScheduledTaskRunStatus` enum, appended
  to `prisma/schema.prisma` only when at least one task is declared.
- `app/api/scheduled-tasks/[task]/route.ts` — the one HTTP endpoint that
  dispatches to `TASK_REGISTRY[task]`.
- `vercel.json`'s `crons` array (Vercel path only — see below).

Hand-authored, not generated (schema-independent, so `generate.py` never
touches them):

- `lib/scheduled-tasks/system-actor.ts` — the fixed lookup email for the
  scheduled-task system actor (see "Who does a scheduled write belong to"
  below).
- `lib/scheduled-tasks/run-all.ts` — the pure planning logic behind
  `task:run-all`: dependency ordering, the "is this task due tonight" check
  and exit-code mapping.
- `scripts/scheduled-task-run.ts` — the entry point behind `task:run` and
  `task:run-all`.
- `scripts/seed-baseline.ts` — upserts that system-actor user.

## Bulk mode (`x-scheduled-tasks`, top-level)

Entity-level `x-scheduled-task` requires a `filter` (`expires_at_before_now`
and/or `status_in`) and always scans exactly one entity's rows. That doesn't
fit an operation that spans many entities/tables, or an entire table with no
filter at all — a full demo-data reset was the motivating case (see
`docs/knowledge/seed-demo-data.md` in a consumer schema that declares one).
`x-scheduled-tasks` is a top-level, plural sibling key for exactly that
shape:

```yaml
x-scheduled-tasks:
  - task_id: demo_reset
    handler: resetDemo
    interval: "0 3 * * *"
```

No `filter` key — bulk mode never selects rows itself; `validate.py` rejects
one if present, precisely because it would silently do nothing (there is no
row scan to apply it to). If a bulk task genuinely needs to filter
something, do that filtering inside the handler itself.

`handler` is still a plain TypeScript identifier — the exported function
name in `lib/scheduled-tasks/<task_id>/service_scheduled_handler.ts` — but
its signature is `(systemActorId: string) => Promise<void>`, not
`(tx, entityId, systemActorId)`: there is no matched row and no per-row
transaction to hand it.

**Business logic still lives outside the generator.** The generated
`service_scheduled.ts` for a bulk task does nothing but import and call the
configured handler — the dispatch file never inlines business logic itself,
same contract as the row-scan variant. The hand-edited handler stub is the
thin layer a consumer wires up; if the actual work already exists elsewhere
(a standalone script, a Server Action), the stub should import and call
that, not reimplement it:

```ts
export async function resetDemo(systemActorId: string): Promise<void> {
  const { main } = await import('@/scripts/reset-demo');
  await main();
}
```

**Namespace and limits are shared with entity-level tasks.** `task_id` must
be unique across both mechanisms (one registry key, one URL segment); the
Vercel 100-cron-jobs-per-project limit below counts entity-level and
top-level tasks together, not as two separate budgets.

## Declaring ordering between tasks (`depends_on`)

`depends_on: [task_id, ...]` is an optional key on both entity-level
`x-scheduled-task` and top-level `x-scheduled-tasks` entries, naming other
`task_id`s (from either mechanism — they share one namespace) that this
task is declared to run after:

```yaml
x-scheduled-tasks:
  - task_id: payment_allocation
    handler: allocatePayments
    interval: "15 17 * * *"
  - task_id: dunning_and_grace
    handler: runDunning
    interval: "30 17 * * *"
    depends_on: [payment_allocation]
```

**The key is enforced twice.** At generate time the graph is validated (below).
At run time every path that runs a task checks that each predecessor has a
usable completion record for the same business date, and refuses to run the
task otherwise (see "Completion records and the run guard"). `task:run-all`
additionally orders its pass so predecessors run first.

**The key only takes effect when it is declared.** A schema that declares no
`depends_on` anywhere generates a graph with no edges, so nothing waits on
anything: every task runs independently, in declaration order under
`task:run-all`. A consumer that wants ordering has to declare `depends_on`
in its own schema.

`generate-code` validates the `depends_on` graph and fails closed —
loudly, at generation time, never silently — on:

- **Self-dependency**: a `task_id` naming itself.
- **Dangling reference**: naming a `task_id` not declared anywhere in
  `x-scheduled-tasks`/`x-scheduled-task` (a typo, or a stale reference to a
  removed/renamed task).
- **Cycle**: any `task_id` reachable from itself by following `depends_on`
  edges, however many hops long.

A straight chain (`a` depends on nothing, `b` depends on `a`, `c` depends
on `b`, ...) is a valid, ordinary use of this key — it is how strict
one-at-a-time ordering across a set of tasks is expressed, with no separate
"serialize these" mechanism needed.

## The `interval` key

`interval` is optional on both entity-level `x-scheduled-task` and
top-level `x-scheduled-tasks` entries. When present it must be a non-empty
five-field cron string.

- **Vercel**: an entry with `interval` gets a `vercel.json` `crons` entry; one
  without gets none, so **nothing invokes it on its own**.
- **`task:run-all`**: `interval` says when a task is *due*, not when to
  invoke it (see "Which tasks run tonight"). A task without one is due every
  night.

`generate-code` cannot check whether the deployment actually runs
`task:run-all` on a schedule — that is a deploy-time fact, not a schema-time
one. **If `task:run-all` is not started every night, an interval-less task is
silently inert.** Before relying on an interval-less task, confirm that
something (Cloud Scheduler, an operator cron, a CI schedule) starts
`task:run-all` nightly.

## Completion records and the run guard

Every run of a task, from any of the three entry points, goes through
`runScheduledTask` in `lib/scheduled-tasks/run-guard.ts`. It reads and writes
one `scheduled_task_run` row per `(task_id, business_date)`; the business
date is the UTC calendar day of the run.

| Column | Meaning |
|---|---|
| `task_id`, `business_date` | Unique together — the row's identity |
| `status` | `running`, `succeeded`, `failed` or `not_due` |
| `started_at`, `finished_at` | When the run began and ended |
| `error_message` | The handler's error message (first 2000 characters), on `failed` |

For each call the guard decides, in this order:

1. A `succeeded` record exists for the business date: **`already_succeeded`**,
   nothing runs. A duplicate delivery is a no-op.
2. A `running` record exists: **`already_running`**, nothing runs. A `running`
   row is either a live concurrent run or a run that crashed before writing a
   terminal status; nothing can tell which, so only `task:run <task_id>` takes
   it over.
3. A declared predecessor has no `succeeded` (or `not_due`) record for the
   business date: **`blocked`**, nothing runs and no record is written. A
   predecessor that was `not_due` tonight counts as satisfied — otherwise a
   daily task behind a weekly one would be blocked six nights in seven.
4. Otherwise the row is claimed as `running`, the handler is called, and the
   row becomes `succeeded`, or `failed` with the error message. A `failed`
   record is retried by the next call for the same business date.

The record is written around the whole handler call, not inside any per-row
transaction: a row-scan task's work spans many independent transactions, so
there is no single one the completion write could share. Handlers therefore
still need to be idempotent (a crash between the handler finishing and the
`succeeded` write leaves a `running` row and a re-run possible).

The generated HTTP route maps the outcomes to status codes: `succeeded` and
`already_succeeded` return 200 (`{ ok, task, outcome }`), `blocked` and
`already_running` return 409, and a handler failure is recorded and then
returns the same 500 as before.

`running` records are only taken over by `task:run <task_id>`, never by the
HTTP route or by `task:run-all`.

**Consumer migration.** The `scheduled_task_run` table is created by the
generated Prisma schema. The generator does not write a migration for it;
a consumer writes that migration when it deploys (the same cadence as any
other schema change), not on every generator bump. Test databases pick the
table up through `db:push`. A consumer that declares no task gets no table.

## Admin page: run status, why a task did not run, and recovery

When the schema declares a scheduled task, `generate-code` also writes an admin
page at `/scheduled_task_run` (sidebar entry "Scheduled Task Run") over the
`scheduled_task_run` table:

- `app/[locale]/scheduled_task_run/page.tsx`, `actions.ts` and
  `components/scheduled_task_run/ScheduledTaskRunTable.tsx`;
- `lib/scheduled-tasks/admin.ts`, the data access and the three actions.

Without a declared task none of these exist, like the table itself.

**What it shows.** One row per declared task for a chosen business date
(default: today, UTC; pick another with the date field or `?date=YYYY-MM-DD`),
including tasks that have no record yet: status, started/finished time, the
recorded message, and a "Why" column.

| Status | Meaning | Why |
|---|---|---|
| Running | a `running` record younger than the stuck threshold | Already running |
| Stuck | a `running` record older than the threshold | Running for too long; it may have crashed |
| Succeeded / Failed | the stored status | (message column carries the error) |
| Not due | a `not_due` record written by `task:run-all` | Not due tonight |
| Blocked | no record, and a declared predecessor has no `succeeded`/`not_due` record | Waiting for the named predecessor(s) |
| Not run yet | no record, nothing holding it back | Has not been run for this date |

Below the table, failed and stuck records of **other** business dates are
listed, newest first (at most 100), so a failure from last week is not lost
just because the date field points at today.

**Who can use it.** Only members of the `ScheduledTaskRunner` role, the same
role that gates the generated HTTP route: grant it through the Role management
UI. Anyone else sees a "you need the role" message and no sidebar entry, an
Administrator included. The Server Actions re-check the role themselves.

**Actions** (each writes an `audit_log` row: `scheduled_task_run.rerun` /
`.resolve` / `.skip`, with the operator, task, business date and reason):

| Action | Available for | Effect |
|---|---|---|
| Rerun | Failed, Stuck, Not due, Blocked, Not run yet | Runs the handler for the **recorded** business date (not today) through the same guard as any run, so a predecessor that has not succeeded still blocks it. A stuck `running` record is taken over. The handler runs inside the request, like a call to the HTTP route. |
| Mark resolved | Failed, Stuck | Sets the record to `succeeded` without running anything, which releases successors waiting on it. The previous error is kept in the message. |
| Skip | Failed, Stuck, Not due, Blocked, Not run yet | Records `succeeded` with no work done. A reason is required and is stored in the message (`Skipped: <reason>`). Works where no record exists, which is how a task that cannot run is stepped over. |

Nothing is offered for a `succeeded` or a fresh `running` record. Mark resolved
and skip both make the record `succeeded`; they differ in that skip also
covers a task with no record, and requires a reason.

**Operational settings.** Two nullable columns on the tenant-wide default
`app_setting` row (`organization_id` NULL), edited through the App Setting UI
with no regeneration:

| Column | Default when NULL | Read by |
|---|---|---|
| `scheduled_task_stuck_after_minutes` | 60 | the admin page, to call a `running` record stuck |
| `scheduled_task_recheck_minutes` | 5 | nothing yet |

`scheduled_task_recheck_minutes` is stored for a predecessor wait/recheck, but
the guard does not wait: a task behind an unmet predecessor is reported
`blocked` and retried on the next run. Nothing reads the column today.

**Consumer migration.** The two `app_setting` columns are added to the base
`prisma/schema.prisma`; a consumer writes that migration when it deploys, like
any other schema change. Test databases pick them up through `db:push`.

**Not covered.** The page has no pagination beyond the 100-row attention list
and does not change the ordering rules or the completion-record model.

## Running tasks directly: `task:run` and `task:run-all`

```sh
npm run task:run -- <task_id>   # one task
npm run task:run-all            # every task, in depends_on order
```

Both run the handlers inside the calling process against the configured
`DATABASE_URL`; they do not call the deployed app's HTTP route, so
`CRON_SECRET` and the `ScheduledTaskRunner` role play no part. Both need the
system-actor user that `db:seed-baseline` creates in the target database
(see "Who does a scheduled write belong to") and stop with an error if it is
missing.

For staging or production, reuse the seed wrapper's environment loading and
`--prod` / `DRY_RUN` handling rather than a second script:

```sh
SEED_COMMAND=task:run-all ./scripts/vercel-seed.sh [--prod]
```

For a nightly trigger on GCP, see "Nightly trigger: Cloud Scheduler + a
minimal Cloud Run Job".

A handler may call anything the deployed app can call (payment gateways,
email, third-party APIs). Run outside the deployed app, **every env var those
handlers read must be present in the environment that runs `task:run` /
`task:run-all`**, not just `DATABASE_URL`.

### Which tasks run tonight

`task:run-all` walks every declared task in dependency order (Kahn's
algorithm; ties between independent branches resolve in schema declaration
order, so the order is the same on every run). For each task:

- a task with no `interval` is always attempted;
- a task with an `interval` is **due** once a cron occurrence has passed since
  its last `succeeded` record, and one that has never succeeded is due
  immediately. A task that is not due gets a `not_due` record and is skipped;
- a due task goes through the guard, so one that already succeeded tonight
  reports `already_succeeded` and does not run again.

The comparison is by UTC calendar day and the cron expression is evaluated in
UTC. A weekly task is picked up on the night its schedule falls; after a long
stop it runs once to catch up rather than once per missed occurrence.

A failed task does not stop the pass. Independent branches still run, and a
task downstream of the failure is reported `blocked` by the guard's
predecessor check. Running `task:run-all` again the same night retries the
failed task and then runs what was blocked behind it; tasks that already
succeeded are not run twice.

### Exit codes

| Command | Code | Meaning |
|---|---|---|
| `task:run` | 0 | Succeeded, or already succeeded for tonight |
| | 1 | The handler threw |
| | 2 | Blocked by a predecessor, or a run is already in progress |
| | 64 | Usage error, or unknown `task_id` |
| `task:run-all` | 0 | Every task succeeded, already succeeded, or was not due |
| | 1 | Any task failed, was blocked, or already had a run in progress |
| | 64 | Usage error |

A `not_due` skip on its own never makes `task:run-all` exit non-zero.

`not_due` records are written only by `task:run-all`. A task started through the
HTTP route on a night `task:run-all` did not run has no `not_due` record for a
weekly predecessor, so it is blocked by that predecessor's missing record.

`task:run <task_id>` is the operator's explicit rerun: it takes over a stale
`running` record and retries a `failed` one, but still refuses to run ahead of
an unsatisfied predecessor.

## Nothing calls this unless something outside the repo calls it

The generated route is a passive HTTP endpoint, and `task:run-all` is a
command. No generated artifact invokes either on a schedule by itself.
Something external has to call `GET /api/scheduled-tasks/<task_id>` (or
`POST` — both are accepted, see below) on the declared `interval`, or start
`task:run-all` every night. Which external caller that is depends on the
deploy target.

## Vercel path (default)

### The generator writes `vercel.json`'s `crons` for you

`generate.py` writes one `crons` entry per `x-scheduled-task` entity into
`vercel.json`:

```json
{ "path": "/api/scheduled-tasks/<task_id>", "schedule": "<interval>" }
```

`vercel.json` at the app-generator submodule root is the file Vercel
actually reads: consumer Vercel projects have their **Root Directory**
project setting pointed at `app-generator/` (`scripts/vercel-setup.sh`'s
Root Directory step sets this — confirmed against the live script, not
assumed), so Vercel resolves `vercel.json` relative to that submodule, not
the consumer repo's own root.

Only the `crons` key is generator-owned. `framework`/`buildCommand`/
`regions` (and anything else a human adds) are read back verbatim and left
untouched on every run — `crons` is fully replaced, not merged, so removing
an `x-scheduled-task` declaration from the schema also removes its cron
entry, the same "no orphaned entries" contract `lib/scheduled-tasks/
registry.ts` already has.

**Do not** place a copy of `vercel.json` under `prj/`. An earlier convention
told consumers to copy the recommended cron entry into `prj/vercel.json` by
hand; `npm run prj:sync` would then copy that file back over the
generator's own `vercel.json` **verbatim on every sync**, silently
reverting whatever the generator had just written. `prj_sync.py` now skips
`vercel.json` outright (prints a warning if a stray one exists) — remove
any old `prj/vercel.json` you already have; it is no longer read.

`x-cloud.provider: gcp` skips this entirely — see the GCP section below.

### HTTP method: GET, not POST

Vercel invokes a cron job's `path` with a plain `GET` request (confirmed
against Vercel's own docs, 2026-08-22 — see "Sources" below). The route
exports both `GET` and `POST` (`export const GET = handleScheduledTask;
export const POST = handleScheduledTask;`) so a Vercel-triggered `GET`
always works and a manual/GCP `POST` still works too. An earlier version of
this route exported `POST` only — Vercel Cron would 405 against it every
time, so no `x-scheduled-task` declaration could ever have actually fired on
Vercel, with no exception anywhere and no red gate to catch it.

**How to confirm it's actually firing**: Vercel dashboard → project →
Cron Jobs → select the job → **View Logs**, or Logs → filter
`requestPath:/api/scheduled-tasks/<task_id>`. A 405 there is exactly the
old, silent-failure symptom above.

### `CRON_SECRET`

Optional but recommended. When set on the Vercel project, Vercel
automatically sends `Authorization: Bearer $CRON_SECRET` on every Cron Job
invocation; the route compares it and skips the `requireScheduledTaskRole`
check (below) when it matches. **Vercel does not generate or set this for
you** — `scripts/vercel-env.sh` now does (generate-once-persist into
`.env.production.local`, injected via `vercel_env_inject`, mirroring
`AUTH_SECRET`'s existing pattern), so running `scripts/vercel-setup.sh` is
enough; no separate manual step. See `.env.example`/
`.env.vercel.production.local.example`.

If `CRON_SECRET` is unset, an unauthenticated Vercel Cron request falls
through to `requireScheduledTaskRole`, which will reject it (no session
cookie, no `X-API-Key`) — a visible 401 in the logs, not a silent no-op.
That is the *only* thing `CRON_SECRET` being unset breaks: Vercel Cron
itself can no longer fire the route.

### Manual triggers require the `ScheduledTaskRunner` role

The non-`CRON_SECRET` path is gated by `requireScheduledTaskRole`
(`lib/api-auth.ts`), not plain `requireDualAuth`: it resolves the caller via
dual-auth (`X-API-Key`/session cookie) exactly as before, then additionally
requires membership in the dedicated `ScheduledTaskRunner` role
(`lib/scheduled-tasks/system-actor.ts`'s `SCHEDULED_TASK_ROLE_NAME`) — a
401 for no/invalid credential, a 403 for an authenticated caller who lacks
the role. `scripts/seed-baseline.ts` seeds this role unconditionally but
with **zero members**, not even the admin account — a fresh deployment
rejects every manual trigger attempt until an operator explicitly grants
the role to a specific account via the Role management UI. This is
narrower than "any Administrator passes": the role is purpose-built for
this one mechanism and is not implied by any other role, including
Administrator.

`CRON_SECRET` is one of three env vars canonically injected via
`scripts/vercel-env.sh`'s `vercel_env_inject` (alongside
`NEXT_PUBLIC_APP_TITLE`/`NEXT_PUBLIC_APP_COPYRIGHT`, unrelated branding
vars — see `docs/knowledge/noindex-default-and-branding-env-vars.md`). The
full injected-var list lives in `.env.vercel.production.local.example`;
local-dev defaults live in `.env.example`. Both are kept in sync with
`scripts/vercel-env.sh` by hand — this doc does not duplicate that list.

### Who does a scheduled write belong to

Every scheduled write is attributed to one fixed system-actor `user` row,
looked up by a **fixed, well-known email**
(`lib/scheduled-tasks/system-actor.ts`'s `SCHEDULED_TASK_ACTOR_EMAIL`,
`scheduled-task-actor@internal.local`) rather than an env-var-configured
user id.

An earlier design used an environment variable a human had to set manually
to an existing user's id — undocumented in `.env.example`, absent from
`vercel-setup.sh`/`vercel-env.sh`, and returning HTTP 500 on **every single
invocation** until someone remembered to set it, with no signal that it was
missing before the first scheduled run actually happened. The fixed-email
lookup removes that step entirely: `scripts/seed-baseline.ts` (the
`db:seed-baseline` npm script) upserts this account unconditionally — the
same script that is already a mandatory step on every setup/deploy path
(`vercel-seed.sh`, `gcp-seed.sh`, the `test:e2e:*` scripts, `setup`,
`build:full`, `dev:full`) — so the account exists before any scheduled task
could ever fire, with no additional configuration step. The account has no
password/api_key: it never signs in or calls the API as itself, it is only
ever referenced by id for `creator_id`/`updater_id` attribution.

### Vercel cron limits (confirmed 2026-08-22, page `last_updated` 2026-07-15
— https://vercel.com/docs/cron-jobs/usage-and-pricing)

| | Cron jobs / project | Minimum interval | Scheduling precision |
|---|---|---|---|
| Hobby | 100 | once per day | ±59 min |
| Pro | 100 | once per minute | per-minute |
| Enterprise | 100 | once per minute | per-minute |

- **100 cron jobs per project, all plans.** `validate.py` rejects a schema
  declaring more than 100 `x-scheduled-task` entities at generate time
  (fail-closed) rather than letting `vercel.json` reach Vercel with an
  unsupported count.
- **Hobby plans can only run once per day.** A more-frequent cron
  expression (e.g. `*/15 * * * *`) is not rejected by `validate.py` (the
  generator has no way to know which Vercel plan a given deployment target
  is on), but **Vercel's own deploy step will fail the build** with "Hobby
  accounts are limited to daily cron jobs" — loud, at deploy time, not a
  silent drop. If you need sub-daily scheduling, use the Pro plan.
- Disabled cron jobs still count toward the 100-job limit.
- Cron delivery is best-effort and can duplicate or skip an invocation —
  handlers must be idempotent/reconciliation-based (see Vercel's "Cron job
  delivery and idempotency" guidance). `service_scheduled_handler.ts`'s
  per-row transaction plus a status/filter-driven query (rather than an
  unconditional increment) already fits this shape; keep new handler logic
  in that same style.
- A cron job for a nonexistent path still executes and 404s — check logs,
  not just "did the deploy succeed."

## GCP path (`x-cloud.provider: gcp`)

`vercel.json` is not read at all under GCP Cloud Run — `generate.py` skips
writing the `crons` key entirely when `x-cloud.provider: gcp` (mirroring how
the same flag switches `app/api/upload/route.ts` from Vercel Blob to GCS).
Per-task Cloud Scheduler jobs that call the HTTP route are not provisioned
by `gcp-setup.sh` or `gcp-deploy.sh`. To create one by hand:

```sh
gcloud scheduler jobs create http <job-name> \
  --schedule="<interval>" \
  --uri="https://<cloud-run-url>/api/scheduled-tasks/<task_id>" \
  --http-method=GET \
  --headers="Authorization=Bearer <CRON_SECRET value>"
```

Cloud Scheduler's HTTP target lets the operator choose `GET` or `POST`
freely (unlike Vercel, which always uses `GET`) — the route accepts both,
so either works. `CRON_SECRET` is not Vercel-specific; the same env var and
`Authorization: Bearer` header work identically here since the route's auth
check doesn't distinguish caller platform.

For a nightly run of every task, use the task-runner Job below instead.

### Nightly trigger: Cloud Scheduler + a minimal Cloud Run Job

`scripts/gcp-task-runner.sh` provisions a small executor on GCP that runs
`npm run task:run-all` every night. The app itself can stay on Vercel; only
the trigger lives on GCP. It creates:

- a Cloud Run Job `task-runner` (image built from the Dockerfile's `builder`
  stage; command `npm run task:run-all`; one task, no retries)
- a Cloud Scheduler job `task-runner-nightly` that POSTs to the Cloud Run
  Jobs API (`.../jobs/task-runner:run`) with an OAuth token
- two service accounts: `task-runner-sa` (the Job's runtime identity, with
  access to its own secrets only) and `task-runner-invoker-sa` (may run this
  one Job, via `roles/run.invoker` on the Job)
- one Secret Manager secret per key in the secrets file (below)

Try it on a separate project first:

```sh
# 1. Configure the target project and region
echo 'PROJECT_ID=<your-test-project>' >> .env.production.local

# 2. Fill in the secrets file (see the warning below)
cp .env.task-runner.production.local.example .env.task-runner.production.local

# 3. Preview: prints every command, runs nothing
DRY_RUN=true ./scripts/gcp-task-runner.sh

# 4. Live run
./scripts/gcp-task-runner.sh
```

Reading the `DRY_RUN` output: every line starting with `[DRY-RUN]` is a
command a live run would execute. No `gcloud` or `docker` process is started
and no secret value is printed, only secret names. Where a live run picks
between `create` and `update` based on what already exists, the preview
shows `create`. The script never falls back to the ambient `gcloud` project;
`PROJECT_ID` must be set explicitly (`DRY_RUN` uses a placeholder if not).

Settings (environment or `.env.production.local`): `REGION`
(default `asia-northeast1`), `SERVICE_NAME`, `REPO_NAME`,
`TASK_RUNNER_SCHEDULE` (cron, default `0 2 * * *`), `TASK_RUNNER_TIME_ZONE`
(default `Asia/Tokyo`), `TASK_RUNNER_TASK_TIMEOUT` (default `3600s`),
`TASK_RUNNER_NPM_SCRIPT` (default `task:run-all`), `TASK_RUNNER_IMAGE` with
`SKIP_BUILD=true` to reuse an image, and `TASK_RUNNER_JOB_NAME` /
`TASK_RUNNER_SCHEDULER_JOB_NAME` / `TASK_RUNNER_SA_NAME` /
`TASK_RUNNER_INVOKER_SA_NAME` for resource names. The Dockerfile is a
generated file, so run `generate-code` with `x-cloud` enabled first when the
script builds the image.

**Collect every production secret, not just the database URL.** The secrets
in `gcp-setup.sh` (`app-database-url` and the others) belong to a Cloud Run
*service* hosted entirely on GCP. They are not what a Job for a
Vercel-hosted app needs, and they are not shared with the Job. A scheduled
task's handler is hand-edited business logic and can call anything the
deployed app can: payment gateways, email or SMS providers, any third-party
API. When the handler runs from the Job instead of inside the deployed app,
every env var it reads must be present in the Job. List **all** production
secrets of the target app (compare with the env vars configured on its
production deployment) in `.env.task-runner.production.local`.
`DATABASE_URL` (unpooled) is required; the script stops if it is missing.
`CRON_SECRET` is not needed, because `task:run-all` runs the tasks directly
and never goes through the HTTP route that checks it. A missing handler key
otherwise fails only at run time, inside the handler that needs it.

Permissions the operator needs: enable APIs (`serviceusage.services.enable`),
create service accounts, secrets, an Artifact Registry repository, a Cloud
Run Job and a Scheduler job, set IAM policies, and act as the two service
accounts. Project Owner covers all of it.

Verify after a live run:

```sh
gcloud scheduler jobs run task-runner-nightly --location=<region> --project=<project>
gcloud run jobs executions list --job=task-runner --region=<region> --project=<project>
```

Cleanup, in a test project: delete the Scheduler job, the Cloud Run Job, the
two service accounts, the `task-runner-*` secrets, and the
`<service>-task-runner` images. Or delete the whole test project.

`gcp-setup.sh` also enables `cloudscheduler.googleapis.com` and, when
`CRON_SECRET` is set in `.env.production.local`, stores it as
`app-cron-secret`. Wiring that secret into the Cloud Run service's env is
still not done by `gcp-deploy.sh`.

### Where the three canonical env vars go under GCP

The Vercel path canonically injects three env vars via `scripts/vercel-env.sh`:
`CRON_SECRET`, `NEXT_PUBLIC_APP_TITLE`, `NEXT_PUBLIC_APP_COPYRIGHT` (the
latter two are branding, not scheduled-task-specific — see
`docs/knowledge/noindex-default-and-branding-env-vars.md`). The GCP path has
no equivalent automation for any of the three yet, but they don't all belong
in the same place:

- **`CRON_SECRET`** is a secret and follows the same pattern as `AUTH_SECRET`
  in `scripts/gcp-setup.sh` Step 5 (`upsert_secret` into GCP Secret Manager)
  and `scripts/gcp-deploy.sh`'s `--set-secrets` flag on `gcloud run deploy` —
  a **runtime** value, read by `process.env.CRON_SECRET` when a request
  arrives, so injecting it at deploy time is sufficient. `gcp-setup.sh` now
  stores it as `app-cron-secret` (when set); `gcp-deploy.sh` does not yet
  mount it into the service.
- **`NEXT_PUBLIC_APP_TITLE`/`NEXT_PUBLIC_APP_COPYRIGHT` are a different kind
  of variable and can't follow the same path.** Next.js inlines
  `NEXT_PUBLIC_` vars into the client bundle at **build** time. On Vercel,
  the platform's own build step already has the project's env vars
  available, so injecting them once via `vercel env add` is enough. On GCP,
  the build is a local `docker build` (`scripts/gcp-deploy.sh` Step 1) with
  no `ARG`/`--build-arg` wiring for these two vars in either
  `code_generator/templates/Dockerfile.jinja2` or `gcp-deploy.sh` today —
  confirmed by reading both. Setting them via `gcloud run deploy
  --set-env-vars` would have no effect: that only sets the *running
  container's* environment, which is too late — the client bundle is already
  built by then, with both vars inlined as unset (empty), same as if they'd
  never been configured at all. Making this work on GCP needs
  `ARG NEXT_PUBLIC_APP_TITLE` / `ARG NEXT_PUBLIC_APP_COPYRIGHT` plus matching
  `ENV` lines added to the Dockerfile template ahead of the `npm run build`
  step, and `--build-arg` passed from `gcp-deploy.sh`'s `docker build` calls.
  **Not yet implemented.**

Both paths still agree on what each var *means* and on the fact that
`NEXT_PUBLIC_APP_TITLE`/`NEXT_PUBLIC_APP_COPYRIGHT` are build-time-only on
either platform — only the mechanics of getting them into that build differ
(Vercel: platform env var, picked up automatically; GCP: would need a Docker
build arg, not yet wired).

## Sources

- https://vercel.com/docs/cron-jobs (How cron jobs work — GET, `vercel-cron/1.0`
  user agent, `x-vercel-cron-schedule` header) — page `last_updated`
  2026-06-16, fetched 2026-08-22.
- https://vercel.com/docs/cron-jobs/usage-and-pricing (limits table above) —
  page `last_updated` 2026-07-15, fetched 2026-08-22.
- https://vercel.com/docs/cron-jobs/manage-cron-jobs (`CRON_SECRET`
  mechanism, error handling, idempotency, deployments/rollbacks) — page
  `last_updated` 2026-07-15, fetched 2026-08-22.
