'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addProcedure, updateProcedure, deleteProcedure } from './service';

export async function upsertProcedure(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('procedure', 'update');
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

  revalidatePath('/');
  redirect('/procedure');
}

export async function removeProcedure(data: FormData | string[]) {
  await requirePermission('procedure', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteProcedure(ids);
  revalidatePath('/');
  redirect('/procedure');
}
