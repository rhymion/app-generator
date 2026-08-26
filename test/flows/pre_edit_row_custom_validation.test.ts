// Generator-level regression test for the pre-edit-row handoff to
// service_validation_custom.ts's validateCustomRules(). lib/organization/
// service_validation_custom.ts (see that file, and
// docs/knowledge/pre-edit-row-handoff-to-custom-validation.md) hand-writes
// a rule that can only be decided by comparing the submitted value against
// what the row held BEFORE this write -- `data` alone (the value being
// submitted) cannot distinguish "clearing an existing marked description"
// from "never had one".
//
// This is a full-stack integration test, not a mocked unit test: it runs
// against a real Postgres test database (same one npm run test:e2e:build
// sets up) via the actual generator-emitted lib/organization/service.ts
// (updateOrganization's real _prevRow fetch + validateOnUpdate call), so it
// requires `generate-code` + `db:push` + `db:generate` to have already run
// against the isolated worktree's test DB, and `next build` (or `next
// dev`) to have been rebuilt AFTER lib/organization/service_validation_custom.ts
// was last edited -- `next start` (what npm run test:e2e:cy:api/:ui use)
// serves a prebuilt server bundle and will silently keep running an older
// version of this file's logic otherwise. See test/flows/
// approval_order_bypass.test.ts for the same DB-backed pattern applied to
// a different generated collaborator.
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');

import { beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@paralleldrive/cuid2';

const { default: prisma } = await import('@/lib/prisma');
const { addOrganization, updateOrganization } = await import('@/lib/organization/service');

const LOCK_MARKER = 'PRE_EDIT_ROW_FIXTURE_LOCKED';

async function createActorUser(): Promise<{ id: string }> {
  const id = createId();
  return prisma.user.create({
    data: {
      id,
      creator_id: id,
      updater_id: id,
      email: `pre-edit-row-actor-${createId()}@example.com`,
      name: 'Pre-Edit-Row Test Actor',
      password: 'not_needed',
    },
  });
}

describe('validateCustomRules receives the pre-edit row', () => {
  let actor: { id: string };

  beforeEach(async () => {
    actor = await createActorUser();
  });

  it('rejects clearing a marker-locked description, using the row as it stood before this write', async () => {
    const { id } = await addOrganization(actor.id, 'Acme Corp', `Original ${LOCK_MARKER} description`, []);

    await expect(
      updateOrganization(actor.id, id, 'Acme Corp', '', [], null),
    ).rejects.toThrow(/description cannot be cleared once locked/);

    const after = await prisma.organization.findUnique({ where: { id } });
    expect(after?.description).toBe(`Original ${LOCK_MARKER} description`);
  });

  it('rejects clearing a marker-locked description via null the same way as via empty string', async () => {
    const { id } = await addOrganization(actor.id, 'Acme Corp', `Original ${LOCK_MARKER} description`, []);

    await expect(
      updateOrganization(actor.id, id, 'Acme Corp', null, [], null),
    ).rejects.toThrow(/description cannot be cleared once locked/);
  });

  it('allows changing a marker-locked description to another value that still carries the marker', async () => {
    const { id } = await addOrganization(actor.id, 'Acme Corp', `Original ${LOCK_MARKER} description`, []);

    await updateOrganization(actor.id, id, 'Acme Corp', `Updated ${LOCK_MARKER} description`, [], null);

    const after = await prisma.organization.findUnique({ where: { id } });
    expect(after?.description).toBe(`Updated ${LOCK_MARKER} description`);
  });

  it('allows clearing an ordinary (unmarked) description -- proves the rule does not fire on plain data, only on the marker read back from prevRow', async () => {
    const { id } = await addOrganization(actor.id, 'Acme Corp', 'Ordinary description', []);

    await updateOrganization(actor.id, id, 'Acme Corp', '', [], null);

    const after = await prisma.organization.findUnique({ where: { id } });
    expect(after?.description).toBe('');
  });

  it('allows an update that leaves an always-empty description empty (no prior value to protect)', async () => {
    const { id } = await addOrganization(actor.id, 'Acme Corp', null, []);

    await updateOrganization(actor.id, id, 'Acme Corp Renamed', '', [], null);

    const after = await prisma.organization.findUnique({ where: { id } });
    expect(after?.name).toBe('Acme Corp Renamed');
    expect(after?.description).toBe('');
  });
});
