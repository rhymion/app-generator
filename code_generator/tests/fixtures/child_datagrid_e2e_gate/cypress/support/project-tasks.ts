// Project tasks for the child-datagrid-e2e-gate. The gate script copies this file to
// cypress/support/project-tasks.ts in the disposable build copy, where cypress.config.ts
// registers whatever getProjectTasks() returns.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/app/generated/prisma/client';
import { TEST_CREDENTIALS } from './test-credentials';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: `${process.env.DATABASE_URL}` }) });

export function getProjectTasks(): Record<string, (...args: any[]) => any> {
  return {
    // db:grantAllPermissions covers the entities generated with test: true, which includes
    // excl_owned. Kept for the specs that call it: it gives the test user's Administrator role
    // the same full permission on excl_owned unless that row already exists.
    async 'db:grantExclOwnedPermission'() {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: TEST_CREDENTIALS.email }, select: { id: true } });
      const role = await prisma.role.findFirstOrThrow({ where: { name: 'Administrator' }, select: { id: true } });
      const existing = await prisma.permission.findFirst({ where: { name: 'excl_owned', role_id: role.id }, select: { id: true } });
      if (existing) return null;
      await prisma.permission.create({
        data: {
          name: 'excl_owned',
          role_id: role.id,
          create: true,
          read: true,
          update: true,
          delete: true,
          import: true,
          creator_id: user.id,
          updater_id: user.id,
        },
      });
      return null;
    },
    // Writes a hook_unit row straight through the database client (the lookup spec needs one
    // that matches the helper's lookup name but not the hand-written value).
    async 'db:insertHookUnit'(params: { name: string; kind: string }) {
      const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
      const row = await prisma.hook_unit.create({
        data: { name: params.name, kind: params.kind, creator_id: user.id, updater_id: user.id },
        select: { id: true },
      });
      return row.id;
    },
    async 'db:getHookUnits'() {
      return prisma.hook_unit.findMany({
        orderBy: { created_at: 'asc' },
        select: { id: true, name: true, kind: true },
      });
    },
    // Writes an excl_link row owned by BOTH parents, straight through the database client.
    // The application rejects such a save, so this is the only way to put in the state that
    // existed before the exactly-one-owner check: it lets a spec show what a save does to it.
    async 'db:insertExclLinkWithBothOwners'(params: { name: string; alphaId: string; betaId: string }) {
      const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
      const row = await prisma.excl_link.create({
        data: {
          name: params.name,
          excl_alpha_id: params.alphaId,
          excl_beta_id: params.betaId,
          creator_id: user.id,
          updater_id: user.id,
        },
        select: { id: true },
      });
      return row.id;
    },
  };
}
