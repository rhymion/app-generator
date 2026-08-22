# Operating the x-scheduled-task mechanism (Vercel and GCP)

`x-scheduled-task` declares a recurring, filtered row-scan + per-row handler
call on any entity. Declaring the key in `code_generator/json_schema.yaml`
is not enough by itself for anything to actually run — this doc is the
operational half: what generate.py produces, what has to be true outside
the repo for it to fire, and how to tell whether it's actually firing.

## What gets generated

For every entity that declares `x-scheduled-task`:

- `lib/{entity}/service_scheduled.ts` — regenerated every `generate-code` run.
  Selects rows matching the declared filter (`expires_at_before_now` and/or
  `status_in`) and calls the configured handler once per row, each in its own
  transaction.
- `lib/{entity}/service_scheduled_handler.ts` — **GENERATED ONCE** (safe to
  hand-edit). The actual side effect. Ships as a `// TODO` stub; nothing
  happens until this is filled in.

Fixed, entity-count-independent (regenerated every run regardless of how
many entities declare the key):

- `lib/scheduled-tasks/registry.ts` — maps every declared `task_id` to its
  entity's `run()` function.
- `app/api/scheduled-tasks/[task]/route.ts` — the one HTTP endpoint that
  dispatches to `TASK_REGISTRY[task]`.
- `vercel.json`'s `crons` array (Vercel path only — see below).

Hand-authored, not generated (schema-independent, so `generate.py` never
touches them):

- `lib/scheduled-tasks/system-actor.ts` — the fixed lookup email for the
  scheduled-task system actor (see "Who does a scheduled write belong to"
  below).
- `scripts/seed-tenant.ts` — upserts that system-actor user.

## Nothing calls this unless something outside the repo calls it

The generated route is a passive HTTP endpoint. No generated artifact
invokes it on a schedule by itself. Something external has to call
`GET /api/scheduled-tasks/<task_id>` (or `POST` — both are accepted, see
below) on the declared `interval`. Which external caller that is depends on
the deploy target.

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
invocation; the route compares it and skips the normal dual-auth
(`X-API-Key`/session cookie) check when it matches. **Vercel does not
generate or set this for you** — `scripts/vercel-env.sh` now does
(generate-once-persist into `.env.production.local`, injected via
`vercel_env_inject`, mirroring `AUTH_SECRET`'s existing pattern), so running
`scripts/vercel-setup.sh` is enough; no separate manual step. See
`.env.example`/`.env.vercel.production.local.example`.

If `CRON_SECRET` is unset, an unauthenticated Vercel Cron request falls
through to `requireDualAuth`, which will reject it (no session cookie, no
`X-API-Key`) — a visible 401 in the logs, not a silent no-op.

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
lookup removes that step entirely: `scripts/seed-tenant.ts` (the
`db:seed-tenant` npm script) upserts this account unconditionally — the
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
**There is no generator/deploy-script automation yet that provisions a GCP
Cloud Scheduler job** — `scripts/gcp-setup.sh`/`gcp-deploy.sh` do not create
one (confirmed by grep, 2026-08-22: no `scheduler`/`cron` reference in
either script). Until that automation exists, provisioning is manual:

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

Adding real Cloud Scheduler automation (parallel to `vercel-setup.sh`'s
`vercel.json` write) is a natural follow-up, not yet scoped.

## Sources

- https://vercel.com/docs/cron-jobs (How cron jobs work — GET, `vercel-cron/1.0`
  user agent, `x-vercel-cron-schedule` header) — page `last_updated`
  2026-06-16, fetched 2026-08-22.
- https://vercel.com/docs/cron-jobs/usage-and-pricing (limits table above) —
  page `last_updated` 2026-07-15, fetched 2026-08-22.
- https://vercel.com/docs/cron-jobs/manage-cron-jobs (`CRON_SECRET`
  mechanism, error handling, idempotency, deployments/rollbacks) — page
  `last_updated` 2026-07-15, fetched 2026-08-22.
