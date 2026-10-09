// Who may open the scheduled-task admin page and use its rerun / resolve /
// skip actions: the same dedicated `ScheduledTaskRunner` role that gates the
// generated HTTP route (see `requireScheduledTaskRole` in lib/api-auth.ts),
// so one role grant covers both. Anyone else, an Administrator included, is
// refused until the role is granted through the Role management UI.
//
// The REST routes under /api/scheduled-task-runs apply the same check to a
// caller authenticated by a mobile access token or API key
// ({@link requireScheduledTaskOperator}).
//
// Hand-authored (schema-independent), like system-actor.ts.
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getSessionUserId } from '@/lib/authz';
import { ApiError, authenticate } from '@/lib/api-auth';
import { SCHEDULED_TASK_ROLE_NAME } from './system-actor';

/** Whether `userId` holds the ScheduledTaskRunner role. */
export async function holdsScheduledTaskRole(userId: string): Promise<boolean> {
  const roleCount = await prisma.role.count({
    where: { name: SCHEDULED_TASK_ROLE_NAME, users: { some: { id: userId } } },
  });
  return roleCount > 0;
}

/** The signed-in user's id when they hold the ScheduledTaskRunner role, else null. */
export async function getScheduledTaskOperatorId(): Promise<string | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return (await holdsScheduledTaskRole(userId)) ? userId : null;
}

/**
 * The caller of a REST route as an operator: a mobile access token or API key
 * (see `authenticate` in lib/api-auth.ts) whose user holds the
 * ScheduledTaskRunner role. Throws ApiError(401) for a missing or invalid
 * credential and ApiError(403) for an authenticated user without the role.
 */
export async function requireScheduledTaskOperator(request: NextRequest): Promise<string> {
  const { userId } = await authenticate(request);
  if (!(await holdsScheduledTaskRole(userId))) {
    throw new ApiError(403, `Scheduled task administration requires the '${SCHEDULED_TASK_ROLE_NAME}' role.`);
  }
  return userId;
}
