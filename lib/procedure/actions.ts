'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addProcedure, updateProcedure, deleteProcedure } from './service';
export async function upsertProcedure(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.procedure.findUnique({ where: { id }, select: { id: true, creator_id: true, assignee_id: true } });
    await requirePermission('procedure', 'update', existing);
  } else {
    await requirePermission('procedure', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const parentId = (data.get('parent_id') as string | null) || null;
  const assigneeId = (data.get('assignee_id') as string | null) || null;
  const childrenRaw = data.getAll('children[]') as string[];
  const childrenItems = childrenRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const childrenIds = childrenItems
    .map((children) => children.id)
    .filter((childrenId): childrenId is string => Boolean(childrenId));
  const precededByRaw = data.getAll('preceded_by[]') as string[];
  const precededByItems = precededByRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const precededByIds = precededByItems
    .map((precededBy) => precededBy.id)
    .filter((precededById): precededById is string => Boolean(precededById));
  const followedByRaw = data.getAll('followed_by[]') as string[];
  const followedByItems = followedByRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const followedByIds = followedByItems
    .map((followedBy) => followedBy.id)
    .filter((followedById): followedById is string => Boolean(followedById));
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateProcedure(userId, id, name, description, parentId, assigneeId, childrenIds, precededByIds, followedByIds, srcSnapshotRaw);
  } else {
    await addProcedure(userId, name, description, parentId, assigneeId, childrenIds, precededByIds, followedByIds);
  }

  redirect('/procedure');
}
export async function removeProcedure(ids: string[]) {
  const [{ permissions: userPermissions, userId }, procedures] = await Promise.all([
    getModelPermissions('procedure'),
    await prisma.procedure.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredProcedures = userPermissions.general.delete
    ? procedures
    : procedures.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredProcedures.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteProcedure(filteredProcedures.map(item => item.id));
  redirect('/procedure');
}

