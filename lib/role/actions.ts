'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addRole, updateRole, deleteRole } from './service';
export async function upsertRole(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.role.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('role', 'update', existing);
  } else {
    await requirePermission('role', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const userAccountsRaw = data.getAll('user_account[]') as string[];
  const userAccountsItems = userAccountsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const userAccountsIds = userAccountsItems
    .map((userAccount) => userAccount.id)
    .filter((userAccountId): userAccountId is string => Boolean(userAccountId));
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateRole(userId, id, name, description, userAccountsIds, srcSnapshotRaw);
  } else {
    await addRole(userId, name, description, userAccountsIds);
  }

  redirect('/role');
}
export async function removeRole(ids: string[]) {
  const [{ permissions: userPermissions, userId }, roles] = await Promise.all([
    getModelPermissions('role'),
    await prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredRoles = userPermissions.general.delete
    ? roles
    : roles.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredRoles.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteRole(filteredRoles.map(item => item.id));
  redirect('/role');
}

