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
    // Makes `email` an approver of vo_item_version and vo_doc_version: a role it holds plus one approval flow.
    async 'db:setupVoApprover'(email: string) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      let role = await prisma.role.findFirst({ where: { name: ROLE_NAME } });
      if (!role) {
        role = await prisma.role.create({ data: { name: ROLE_NAME, creator_id: user.id, updater_id: user.id } });
      }
      await prisma.role.update({ where: { id: role.id }, data: { users: { connect: [{ id: user.id }] } } });
      // The version entity is generated with test: false, so db:grantAllPermissions
      // does not cover it; grant the approver role full access explicitly.
      for (const name of ['vo_item_version', 'vo_item_version_line', 'vo_doc_version']) {
        await prisma.permission.create({
          data: {
            name, role_id: role.id, create: true, read: true, update: true, delete: true, import: true,
            creator_id: user.id, updater_id: user.id,
          },
        });
      }
      for (const entity_name of ['vo_item_version', 'vo_doc_version']) {
        await prisma.approval_flow.deleteMany({ where: { entity_name } });
        await prisma.approval_flow.create({
          data: { entity_name, approver_role_id: role.id, creator_id: user.id, updater_id: user.id },
        });
      }
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
    async 'db:voDraft'(versionId: string) {
      const v = await prisma.vo_item_version.findUniqueOrThrow({
        where: { id: versionId },
        select: {
          title: true, status: true, ref_code: true, attachable_id: true,
          vo_item_version_lines: { select: { note: true, line_code: true }, orderBy: { note: 'asc' } },
        },
      });
      return {
        title: v.title, status: v.status, ref_code: v.ref_code, attachable_id: v.attachable_id,
        notes: v.vo_item_version_lines.map((l) => l.note), codes: v.vo_item_version_lines.map((l) => l.line_code),
      };
    },
    async 'db:voAttachableId'(versionId: string) {
      return (await prisma.vo_item_version.findUniqueOrThrow({ where: { id: versionId }, select: { attachable_id: true } })).attachable_id;
    },
    // Statuses of every approval request of a version row, oldest first.
    async 'db:voRequestStatuses'(versionId: string) {
      const row = await prisma.vo_item_version.findUniqueOrThrow({ where: { id: versionId }, select: { approvable_id: true } });
      const reqs = await prisma.approval_request.findMany({
        where: { approvable_id: row.approvable_id }, orderBy: { created_at: 'asc' }, select: { status: true },
      });
      return reqs.map((r) => r.status);
    },
    // The same two lookups for the second pair, whose rejection is not terminal.
    async 'db:voDocPendingRequestId'(versionId: string) {
      const row = await prisma.vo_doc_version.findUnique({ where: { id: versionId }, select: { approvable_id: true } });
      if (!row) return null;
      const req = await prisma.approval_request.findFirst({
        where: { approvable_id: row.approvable_id, status: 'pending' },
        select: { id: true },
      });
      return req?.id ?? null;
    },
    async 'db:voDocState'(docId: string) {
      const doc = await prisma.vo_doc.findUniqueOrThrow({ where: { id: docId } });
      const versions = await prisma.vo_doc_version.findMany({
        where: { vo_doc_id: docId },
        orderBy: { created_at: 'asc' },
        select: { id: true, version_no: true, status: true },
      });
      return { current_version_id: doc.current_version_id, versions };
    },
    async 'db:voLineCount'(versionId: string) {
      return prisma.vo_item_version_line.count({ where: { vo_item_version_id: versionId } });
    },
  };
}
