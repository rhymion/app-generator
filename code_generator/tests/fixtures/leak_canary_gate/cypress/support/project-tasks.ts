// Fixture-only Cypress tasks of the leak-canary-gate. Copied to cypress/support/project-tasks.ts of the disposable
// build copy; cypress.config.ts loads it when present.
//
// `leakCanary:seed` writes the run's marker values (.leak-canary/plan.json, made by
// code_generator/leak_canary.py) into the secret-bearing columns the manifest names. What row a
// column lives on is declared by the manifest (`row`); how a row of a table is created is the
// factory table below, the one place that knows a table's required columns.
import * as fs from 'node:fs';
import { createId } from '@paralleldrive/cuid2';

type Plan = Record<string, { kind: string; value: string; table?: string; column?: string; row?: string }>;
type Ctx = { prisma: any; actorId: string; victimId: string; orgA: string; orgB: string };

const FACTORIES: Record<string, (ctx: Ctx, row: string, column: string, value: string) => Promise<unknown>> = {
  user: (c, _row, column, value) => c.prisma.user.update({ where: { id: c.victimId }, data: { [column]: value } }),
  mfa_recovery_code: (c, _row, column, value) =>
    c.prisma.mfa_recovery_code.create({ data: { user_id: c.victimId, code_hash: 'x', [column]: value } }),
  mobile_session: (c, _row, column, value) =>
    c.prisma.mobile_session.create({
      data: {
        user_id: c.victimId,
        refresh_token_hash: createId(),
        expires_at: new Date(Date.now() + 86_400_000),
        [column]: value,
      },
    }),
  attachment: (c, _row, column, value) =>
    c.prisma.attachment.create({ data: { name: 'canary.txt', path: `canary/${createId()}`, [column]: value } }),
  lk_vault: (c, row, column, value) =>
    c.prisma.lk_vault.create({
      data: {
        title: `vault ${createId()}`,
        organization_id: row === 'vault_org_b' ? c.orgB : c.orgA,
        creator_id: c.actorId,
        updater_id: c.actorId,
        [column]: value,
      },
    }),
};

export function getProjectTasks(): Record<string, (...args: any[]) => any> {
  return {
    async 'leakCanary:seed'() {
      const { prisma } = require('./db-helpers');
      const { TEST_CREDENTIALS } = require('./test-credentials');
      const plan: Plan = JSON.parse(fs.readFileSync('.leak-canary/plan.json', 'utf-8'));
      const actor = await prisma.user.findUnique({ where: { email: TEST_CREDENTIALS.email } });
      if (!actor) throw new Error('Test user not found. Run db:seed first.');
      const orgA = await prisma.organization.create({
        data: { name: `LeakA_${createId()}`, creator_id: actor.id, updater_id: actor.id, users: { connect: [{ id: actor.id }] } },
      });
      const orgB = await prisma.organization.create({
        data: { name: `LeakB_${createId()}`, creator_id: actor.id, updater_id: actor.id },
      });
      const victim = await prisma.user.create({
        data: {
          email: `victim-${createId()}@example.test`,
          name: 'Canary Victim',
          creator_id: actor.id,
          updater_id: actor.id,
          organizations: { connect: [{ id: orgA.id }] },
        },
      });
      const ctx: Ctx = { prisma, actorId: actor.id, victimId: victim.id, orgA: orgA.id, orgB: orgB.id };
      const seeded: string[] = [];
      for (const [id, canary] of Object.entries(plan)) {
        if (canary.kind !== 'db') continue;
        const factory = FACTORIES[canary.table as string];
        if (!factory) throw new Error(`leak canary ${id}: no seed factory for table ${canary.table}`);
        await factory(ctx, canary.row as string, canary.column as string, canary.value);
        seeded.push(id);
      }
      return seeded;
    },
  };
}
