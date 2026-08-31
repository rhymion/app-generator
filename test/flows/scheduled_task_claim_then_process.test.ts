// cmd_886: service_scheduled.ts.jinja2's dispatch loop now claims a row
// before calling the handler, instead of dispatching to every row
// `findMany` returned unconditionally. This closes a real double-dispatch
// race: Vercel Cron delivery is documented as best-effort and can invoke
// the same task twice for one run, so two overlapping invocations can both
// see a row as eligible from their own `findMany` before either has
// processed it -- without a claim step, both go on to call the handler for
// the same row.
//
// The claim is a transaction-scoped advisory lock keyed on the row id,
// followed by a re-check of the same filter against the now-locked row.
// The second invocation blocks on the lock until the first invocation's
// whole transaction (lock + recheck + handler call) commits, then its own
// recheck sees the handler's committed write and skips if the row no
// longer matches.
//
// An updateMany-with-updated_at-compare-and-swap alternative was tried
// first and rejected here, empirically: `updated_at` is
// `@db.Timestamptz(0)` (whole-second precision,
// docs/knowledge/prisma-schema-conventions.md §4), so two invocations
// racing within the same wall-clock second can write and re-read it as
// identical values -- a CAS on that column silently never detects the
// second invocation for exactly the near-simultaneous double-delivery case
// this guard exists for. The first test below is the reproduction of that
// failure (kept as a regression control); the second test proves the
// chosen advisory-lock design does not share the flaw.
//
// This repo's own json_schema.yaml declares no x-scheduled-task entity (see
// code_generator/tests/test_scheduled_task_templates.py's module docstring
// -- the mechanism is exercised out of band, against a real consumer
// schema), so there is no generated service_scheduled.ts in this repo to
// drive end-to-end. Same rationale and pattern as
// test/flows/approval_order_bypass.test.ts and
// test/flows/multistage_approval_rounds.test.ts: a hand-built fixture,
// real-Postgres integration test proves the exact Prisma/SQL shape the
// template emits actually prevents double execution under a real
// concurrent race, using an existing model (`role`) rather than
// reimplementing the generated dispatcher. Requires `db:push` +
// `db:generate` + `db:seed-baseline` to have already run against the
// isolated worktree's test DB (same precondition as the other test/flows
// specs).
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');

import { describe, expect, it } from 'vitest';
import { createId } from '@paralleldrive/cuid2';

const { default: prisma } = await import('@/lib/prisma');

/**
 * A `role` row plus the self-referencing `user` needed to satisfy its
 * mandatory `creator_id`/`updater_id` FKs -- same bootstrap shape as
 * test/flows/approval_order_bypass.test.ts's `buildOutOfOrderChain`. `role`
 * stands in for any x-scheduled-task entity here: `name` stands in for a
 * domain status column (the eligibility filter), and every custom model
 * carries the mandatory `updated_at` column
 * (docs/knowledge/prisma-schema-conventions.md §4) used by the rejected
 * CAS design below.
 */
async function makeClaimTestRow(initialName: string) {
  const actorId = createId();
  const actor = await prisma.user.create({
    data: {
      id: actorId,
      creator_id: actorId,
      updater_id: actorId,
      email: `claim-race-${actorId}@example.com`,
      name: 'Claim Race Test Actor',
      password: 'not_needed',
    },
  });
  return prisma.role.create({
    data: { name: initialName, creator_id: actor.id, updater_id: actor.id },
  });
}

describe('scheduled-task dispatcher claim-then-process guard (cmd_886)', () => {
  it('rejected design, regression control: updated_at compare-and-swap does not detect a same-second race', async () => {
    const row = await makeClaimTestRow('cas-test');
    let handlerCalls = 0;

    const snapshotA = await prisma.role.findUnique({
      where: { id: row.id },
      select: { id: true, updated_at: true },
    });
    const snapshotB = await prisma.role.findUnique({
      where: { id: row.id },
      select: { id: true, updated_at: true },
    });
    expect(snapshotA).not.toBeNull();
    expect(snapshotB).not.toBeNull();
    expect(snapshotA!.updated_at).toEqual(snapshotB!.updated_at);

    async function casClaimThenProcess(snapshot: { id: string; updated_at: Date }) {
      const claim = await prisma.role.updateMany({
        where: { id: snapshot.id, updated_at: snapshot.updated_at },
        data: { updated_at: new Date() },
      });
      if (claim.count === 0) return;
      handlerCalls++;
    }

    // Sequential is enough to reproduce this failure -- it is not a timing
    // race, it is that the write and the captured value round to the same
    // stored timestamp regardless of ordering.
    await casClaimThenProcess(snapshotA!);
    await casClaimThenProcess(snapshotB!);

    expect(handlerCalls).toBe(2); // the flaw: both "invocations" ran the handler
  });

  it('chosen design: two truly concurrent dispatches both see the row eligible, but only the first successfully claims it -- handler runs once', async () => {
    const row = await makeClaimTestRow('eligible-marker');
    let handlerCalls = 0;

    async function claimThenProcess() {
      await prisma.$transaction(async (tx) => {
        // Exact shape service_scheduled.ts.jinja2 now emits.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.id}, 0))`;
        const stillEligible = await tx.role.count({ where: { id: row.id, name: 'eligible-marker' } });
        if (stillEligible === 0) return;
        handlerCalls++;
        // The handler disqualifies the row from the filter -- same as
        // afterExpire setting status away from pending/active.
        await tx.role.update({ where: { id: row.id }, data: { name: 'processed-marker' } });
      });
    }

    await Promise.all([claimThenProcess(), claimThenProcess()]);

    expect(handlerCalls).toBe(1);
    const final = await prisma.role.findUnique({ where: { id: row.id } });
    expect(final?.name).toBe('processed-marker');
  });

  it('regression control: no lock/recheck at all -- naive concurrent dispatch runs the handler twice', async () => {
    const row = await makeClaimTestRow('eligible-marker');
    let handlerCalls = 0;

    async function naiveDispatch() {
      await prisma.$transaction(async (tx) => {
        handlerCalls++;
        await tx.role.update({ where: { id: row.id }, data: { name: 'processed-marker' } });
      });
    }

    await Promise.all([naiveDispatch(), naiveDispatch()]);

    expect(handlerCalls).toBe(2);
  });

  it('a row no invocation has touched yet still claims successfully (no false-negative skip)', async () => {
    const row = await makeClaimTestRow('eligible-marker');
    let handlerCalls = 0;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.id}, 0))`;
      const stillEligible = await tx.role.count({ where: { id: row.id, name: 'eligible-marker' } });
      if (stillEligible === 0) return;
      handlerCalls++;
    });

    expect(handlerCalls).toBe(1);
  });
});
