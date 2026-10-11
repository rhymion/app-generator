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
      // The version entity is generated with test: false, so db:grantAllPermissions
      // does not cover it (nor vo_item); grant the approver role full access explicitly.
      for (const name of ['vo_item', 'vo_item_version', 'vo_item_version_line']) {
        await prisma.permission.create({
          data: {
            name, role_id: role.id, create: true, read: true, update: true, delete: true, import: true,
            creator_id: user.id, updater_id: user.id,
          },
        });
      }
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
    async 'db:voCreateItem'(name: string) {
      const user = await prisma.user.findFirstOrThrow({ orderBy: { created_at: 'asc' } });
      return (await prisma.vo_item.create({ data: { name, creator_id: user.id, updater_id: user.id }, select: { id: true } })).id;
    },
    // Two organizations; `email` belongs to the first only.
    async 'db:voSeedOrgs'(email: string) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const mk = (name: string, members: string[]) =>
        prisma.organization.create({
          data: { name, creator_id: user.id, updater_id: user.id, users: { connect: members.map((id) => ({ id })) } },
          select: { id: true },
        });
      const own = await mk(`VoOrgOwn-${Date.now()}`, [user.id]);
      const foreign = await mk(`VoOrgForeign-${Date.now()}`, []);
      return { own: own.id, foreign: foreign.id };
    },
    // Inserts a version row directly: approved (numbered, optionally current) or an open draft.
    async 'db:voInsertVersion'(p: {
      itemId: string; orgId: string; title: string; notes?: string; versionNo: number | null; current?: boolean; lines?: string[];
    }) {
      const user = await prisma.user.findFirstOrThrow({ orderBy: { created_at: 'asc' } });
      const approvable = await prisma.approvable.create({
        data: { creator_id: user.id, approved_at: p.versionNo == null ? null : new Date() },
      });
      const version = await prisma.vo_item_version.create({
        data: {
          vo_item_id: p.itemId, organization_id: p.orgId, title: p.title, notes: p.notes ?? null, version_no: p.versionNo,
          status: p.versionNo == null ? 'draft' : 'approved', approvable_id: approvable.id,
          creator_id: user.id, updater_id: user.id,
          vo_item_version_lines: { create: (p.lines ?? []).map((note) => ({ note })) },
        },
      });
      if (p.current) await prisma.vo_item.update({ where: { id: p.itemId }, data: { current_version_id: version.id } });
      return version.id;
    },
    // Removes read access to the version entity from every role.
    async 'db:voRevokeVersionRead'() {
      await prisma.permission.updateMany({ where: { name: 'vo_item_version' }, data: { read: false } });
      return null;
    },
    async 'db:voLineCount'(versionId: string) {
      return prisma.vo_item_version_line.count({ where: { vo_item_version_id: versionId } });
    },
  };
}
