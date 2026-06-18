'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addOrganization, updateOrganization, deleteOrganization } from './service';
export async function upsertOrganization(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('organization', 'update', existing);
  } else {
    await requirePermission('organization', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const usersRaw = data.getAll('user[]') as string[];
  const usersItems = usersRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const usersIds = usersItems
    .map((user) => user.id)
    .filter((userId): userId is string => Boolean(userId));
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateOrganization(actorId, id, name, description, usersIds, srcSnapshotRaw);
  } else {
    await addOrganization(actorId, name, description, usersIds);
  }

  redirect('/organization');
}
export async function removeOrganization(ids: string[]) {
  const [{ permissions: userPermissions, userId }, organizations] = await Promise.all([
    getModelPermissions('organization'),
    await prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredOrganizations = userPermissions.general.delete
    ? organizations
    : organizations.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredOrganizations.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteOrganization(filteredOrganizations.map(item => item.id));
  revalidatePath('/[locale]/organization', 'page');
  redirect('/organization');
}

