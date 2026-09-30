// Who may open the scheduled-task admin page and use its rerun / resolve /
// skip actions: the same dedicated `ScheduledTaskRunner` role that gates the
// generated HTTP route (see `requireScheduledTaskRole` in lib/api-auth.ts),
// so one role grant covers both. Anyone else, an Administrator included, is
// refused until the role is granted through the Role management UI.
//
// Hand-authored (schema-independent), like system-actor.ts.
import prisma from '@/lib/prisma';
import { getSessionUserId } from '@/lib/authz';
import { SCHEDULED_TASK_ROLE_NAME } from './system-actor';

/** The signed-in user's id when they hold the ScheduledTaskRunner role, else null. */
export async function getScheduledTaskOperatorId(): Promise<string | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const roleCount = await prisma.role.count({
    where: { name: SCHEDULED_TASK_ROLE_NAME, users: { some: { id: userId } } },
  });
  return roleCount > 0 ? userId : null;
}
