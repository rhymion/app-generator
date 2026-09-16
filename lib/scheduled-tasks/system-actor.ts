// Fixed lookup key for the x-scheduled-task mechanism's system actor account
// (cmd_781). scripts/seed-baseline.ts upserts a `user` row with this email;
// app/api/scheduled-tasks/[task]/route.ts looks it up by this email at
// request time and uses its id as every scheduled write's creator_id/
// updater_id. A fixed email — not an env-var-configured user id — means
// there is nothing to separately capture and set as a deployment secret:
// the account exists as soon as the already-mandatory db:seed-baseline step
// has run, on both the Vercel and GCP deploy paths.
//
// Hand-authored, not generated: this file is schema-independent (the same
// account backs every x-scheduled-task declaration, however many entities
// declare the key), so generate.py never writes it, unlike its sibling
// lib/scheduled-tasks/registry.ts.
export const SCHEDULED_TASK_ACTOR_EMAIL = 'scheduled-task-actor@internal.local';

// Dedicated role gating manual (non-`CRON_SECRET`) calls to the generated
// `/api/scheduled-tasks/[task]` route (cmd_787) — see
// `lib/api-auth.ts`'s `requireScheduledTaskRole`. Kept here (framework-free,
// no `next/server` import) rather than in lib/api-auth.ts itself so
// scripts/seed-baseline.ts — a plain Node script, not a Next.js request
// handler — can import it without pulling in Next's server runtime.
// scripts/seed-baseline.ts seeds this role with zero members by default: an
// operator must explicitly grant it via the Role management UI before any
// account can trigger a scheduled task outside of Vercel Cron's own
// `CRON_SECRET` path.
export const SCHEDULED_TASK_ROLE_NAME = 'ScheduledTaskRunner';
