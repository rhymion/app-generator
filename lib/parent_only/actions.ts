'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addParentOnly, updateParentOnly, deleteParentOnly } from './service';
export async function upsertParentOnly(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.parent_only.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('parent_only', 'update', existing);
  } else {
    await requirePermission('parent_only', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const loginTimeStr = data.get('login_time') as string | null;
  const loginTime = loginTimeStr ? new Date(loginTimeStr) : null;
  const logoutTimeStr = data.get('logout_time') as string | null;
  const logoutTime = logoutTimeStr ? new Date(logoutTimeStr) : null;
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateParentOnly(userId, id, name, description, loginTime, logoutTime, srcSnapshotRaw);
  } else {
    await addParentOnly(userId, name, description, loginTime, logoutTime);
  }

  redirect('/parent_only');
}
export async function removeParentOnly(ids: string[]) {
  const [{ permissions: userPermissions, userId }, parentOnlys] = await Promise.all([
    getModelPermissions('parent_only'),
    await prisma.parent_only.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredParentOnlys = userPermissions.general.delete
    ? parentOnlys
    : parentOnlys.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredParentOnlys.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteParentOnly(filteredParentOnlys.map(item => item.id));
  redirect('/parent_only');
}

