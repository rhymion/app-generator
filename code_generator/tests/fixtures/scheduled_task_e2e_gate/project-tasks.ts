// Cypress tasks for the scheduled-task-e2e-gate specs. The gate script copies this file to
// cypress/support/project-tasks.ts of its disposable build copy (the file cypress.config.ts
// loads project-specific tasks from), so the repository's own Cypress setup is untouched.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/app/generated/prisma/client';
import { createId } from '@paralleldrive/cuid2';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: `${process.env.DATABASE_URL}` }) });

const ROLE_NAME = 'ScheduledTaskRunner';
const SCHEDULED_TASK_ACTOR_EMAIL = 'scheduled-task-actor@internal.local';

export function getProjectTasks(): Record<string, (...args: any[]) => any> {
  return {
    // Empties the completion-record table (db:reset does not know it) and makes sure the
    // scheduled-task system account exists: reruns run the handler as that account, and
    // db:seed does not create it (scripts/seed-baseline.ts does).
    async 'db:prepareScheduledTasks'() {
      await prisma.scheduled_task_run.deleteMany();
      const actorId = createId();
      await prisma.user.upsert({
        where: { email: SCHEDULED_TASK_ACTOR_EMAIL },
        update: {},
        create: {
          id: actorId,
          creator_id: actorId,
          updater_id: actorId,
          email: SCHEDULED_TASK_ACTOR_EMAIL,
          name: 'Scheduled Task System',
        },
      });
      return null;
    },
    // Makes the user with `email` a member of the ScheduledTaskRunner role (created when absent).
    async 'db:grantScheduledTaskRole'(email: string) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      let role = await prisma.role.findFirst({ where: { name: ROLE_NAME } });
      if (!role) {
        role = await prisma.role.create({ data: { name: ROLE_NAME, creator_id: user.id, updater_id: user.id } });
      }
      await prisma.role.update({ where: { id: role.id }, data: { users: { connect: [{ id: user.id }] } } });
      return null;
    },
    async 'db:seedScheduledTaskRun'(params: {
      taskId: string;
      businessDate: string;
      status: 'running' | 'succeeded' | 'failed' | 'not_due';
      startedAt?: string;
      errorMessage?: string;
    }) {
      await prisma.scheduled_task_run.create({
        data: {
          id: createId(),
          task_id: params.taskId,
          business_date: new Date(`${params.businessDate}T00:00:00.000Z`),
          status: params.status,
          started_at: new Date(params.startedAt ?? Date.now()),
          finished_at: params.status === 'running' ? null : new Date(),
          error_message: params.errorMessage ?? null,
        },
      });
      return null;
    },
    // The stored record for a task and business date, or null.
    async 'db:getScheduledTaskRun'(params: { taskId: string; businessDate: string }) {
      const row = await prisma.scheduled_task_run.findUnique({
        where: {
          task_id_business_date: {
            task_id: params.taskId,
            business_date: new Date(`${params.businessDate}T00:00:00.000Z`),
          },
        },
      });
      return row ? { status: row.status, error_message: row.error_message } : null;
    },
    // audit_log rows written by one of the operator actions.
    async 'db:getScheduledTaskAuditRows'(action: string) {
      const rows = await prisma.audit_log.findMany({ where: { action }, include: { actor_user: { select: { email: true } } } });
      return rows.map((row) => ({
        actor_email: row.actor_user?.email ?? null,
        target_table: row.target_table,
        metadata: row.metadata,
      }));
    },
  };
}
