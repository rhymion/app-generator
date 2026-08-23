// Fixed lookup key for the x-scheduled-task mechanism's system actor account
// (cmd_781). scripts/seed-tenant.ts upserts a `user` row with this email;
// app/api/scheduled-tasks/[task]/route.ts looks it up by this email at
// request time and uses its id as every scheduled write's creator_id/
// updater_id. A fixed email — not an env-var-configured user id — means
// there is nothing to separately capture and set as a deployment secret:
// the account exists as soon as the already-mandatory db:seed-tenant step
// has run, on both the Vercel and GCP deploy paths.
//
// Hand-authored, not generated: this file is schema-independent (the same
// account backs every x-scheduled-task declaration, however many entities
// declare the key), so generate.py never writes it, unlike its sibling
// lib/scheduled-tasks/registry.ts.
export const SCHEDULED_TASK_ACTOR_EMAIL = 'scheduled-task-actor@internal.local';
