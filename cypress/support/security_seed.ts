// Seeding for the reference-shape security tests (cypress.config.ts tasks `security:seedRow`,
// `security:updateRow`, `security:seedScopedActor`; wrappers in security_helpers.ts).
//
// A write that carries a reference is tested against a row the actor cannot reach: a row of another
// organization, or a row outside the actor's Creator / Assignee read scope. These helpers place such
// rows directly in the database, for any model, so a spec can build exactly the scenario it needs.
// Node-only (Prisma); never imported by a spec bundle.
import { createId } from '@paralleldrive/cuid2';
import { createKeyedUser, prisma } from './db-helpers';
import { TEST_CREDENTIALS } from './test-credentials';

type Delegate = {
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
};

function delegate(model: string): Delegate {
  const d = (prisma as unknown as Record<string, Delegate | undefined>)[model];
  if (!d || typeof d.create !== 'function') throw new Error(`security_seed: unknown model "${model}"`);
  return d;
}

async function testUserId(): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email: TEST_CREDENTIALS.email } });
  if (!user) throw new Error('Test user not found. Run db:seed first.');
  return user.id;
}

/**
 * Creates one row of `model` with exactly `data` (audit columns included: a model such as `commentable`
 * has none, so nothing is filled in).
 */
export async function seedRow(model: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const row = await delegate(model).create({ data });
  return JSON.parse(JSON.stringify(row));
}

export async function updateRow(model: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const row = await delegate(model).update({ where: { id }, data });
  return JSON.parse(JSON.stringify(row));
}

type Flags = { create?: boolean; read?: boolean; update?: boolean; delete?: boolean; import?: boolean };
type Grant = { entity: string; scope: 'general' | 'Creator' | 'Assignee'; flags: Flags };

const NO_FLAGS = { create: false, read: false, update: false, delete: false, import: false };

/**
 * An API-key actor who belongs to `organizationIds` and holds exactly `grants`: a `general` grant applies
 * to every row of the entity, a `Creator` / `Assignee` grant only to rows the actor created / is assigned
 * to (the special roles of lib/authz.ts). The Creator and Assignee roles are shared by every user who holds
 * them, so a grant on them replaces that role's row for the entity.
 */
export async function seedScopedActor(
  label: string,
  organizationIds: string[],
  grants: Grant[],
): Promise<{ apiKey: string; userId: string }> {
  const adminId = await testUserId();
  const userId = createId();
  const apiKey = `test_mk_scoped_${label}_${userId}`;
  const ownRole = await prisma.role.create({
    data: { name: `ScopedRole_${label}_${userId}`, creator_id: adminId, updater_id: adminId },
  });
  const roleIds = new Set<string>([ownRole.id]);
  for (const grant of grants) {
    let roleId = ownRole.id;
    if (grant.scope !== 'general') {
      let role = await prisma.role.findFirst({ where: { name: grant.scope } });
      if (!role) {
        role = await prisma.role.create({ data: { name: grant.scope, creator_id: adminId, updater_id: adminId } });
      }
      roleId = role.id;
      roleIds.add(role.id);
    }
    const flags = { ...NO_FLAGS, ...grant.flags };
    await prisma.permission.upsert({
      where: { name_role_id: { name: grant.entity, role_id: roleId } },
      update: flags,
      create: { name: grant.entity, role_id: roleId, creator_id: adminId, updater_id: adminId, ...flags },
    });
  }
  await createKeyedUser(apiKey, {
    data: {
      id: userId,
      creator_id: userId,
      updater_id: userId,
      email: `scoped_${label}_${userId}@example.com`,
      name: `Scoped actor (${label})`,
      password: 'not_needed',
      roles: { connect: [...roleIds].map((id) => ({ id })) },
      organizations: { connect: organizationIds.map((id) => ({ id })) },
    },
  });
  return { apiKey, userId };
}
