// Cypress tasks for the version-of-e2e-gate specs. The gate script copies this file to
// cypress/support/project-tasks.ts of its disposable build copy (the file cypress.config.ts
// loads project-specific tasks from), so the repository's own Cypress setup is untouched.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/app/generated/prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: `${process.env.DATABASE_URL}` }) });

const ROLE_NAME = 'VoApprover';

export function getProjectTasks(): Record<string, (...args: any[]) => any> {
  return {
    // Makes `email` an approver of vo_item_version: a role it holds plus one approval flow.
    async 'db:setupVoApprover'(email: string) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      let role = await prisma.role.findFirst({ where: { name: ROLE_NAME } });
      if (!role) {
        role = await prisma.role.create({ data: { name: ROLE_NAME, creator_id: user.id, updater_id: user.id } });
      }
      await prisma.role.update({ where: { id: role.id }, data: { users: { connect: [{ id: user.id }] } } });
      await prisma.approval_flow.deleteMany({ where: { entity_name: 'vo_item_version' } });
      await prisma.approval_flow.create({
        data: { entity_name: 'vo_item_version', approver_role_id: role.id, creator_id: user.id, updater_id: user.id },
      });
      return null;
    },
    // The pending approval request of a version row (null when none).
    async 'db:voPendingRequestId'(versionId: string) {
      const row = await prisma.vo_item_version.findUnique({ where: { id: versionId }, select: { approvable_id: true } });
      if (!row) return null;
      const req = await prisma.approval_request.findFirst({
        where: { approvable_id: row.approvable_id, status: 'pending' },
        select: { id: true },
      });
      return req?.id ?? null;
    },
    // What the database holds for an identity: its current version and every version row.
    async 'db:voState'(itemId: string) {
      const item = await prisma.vo_item.findUniqueOrThrow({ where: { id: itemId } });
      const versions = await prisma.vo_item_version.findMany({
        where: { vo_item_id: itemId },
        orderBy: { created_at: 'asc' },
        select: { id: true, version_no: true, status: true },
      });
      return { current_version_id: item.current_version_id, versions };
    },
    async 'db:voLineCount'(versionId: string) {
      return prisma.vo_item_version_line.count({ where: { vo_item_version_id: versionId } });
    },
  };
}
