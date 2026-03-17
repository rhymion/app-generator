'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addParent1, updateParent1, deleteParent1 } from './service';
export async function upsertParent1(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.parent1.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('parent1', 'update', existing);
  } else {
    await requirePermission('parent1', 'create');
  }
  const name = data.get('name') as string;
  const organizationId = data.get('organization_id') as string;
  const description = data.get('description') as string | null;
  const price = Number(data.get('price'));
  const dueDateStr = data.get('due_date') as string;
  const dueDate = new Date(dueDateStr);
  const imageUrl = data.get('image_url') as string | null;
  const parent1Child1sRaw = data.getAll('parent1_child1[]') as string[];
  const parent1Child1sItems = parent1Child1sRaw.map(f => JSON.parse(f) as { order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });
  const parent1Child2sRaw = data.getAll('parent1_child2[]') as string[];
  const parent1Child2sItems = parent1Child2sRaw.map(f => JSON.parse(f) as { name: string; required: boolean; start_date: Date | null; end_date: Date });
  const parent1ListsRaw = data.getAll('parent1_list[]') as string[];
  const parent1ListsItems = parent1ListsRaw.map(f => JSON.parse(f) as { name: string });
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateParent1(userId, id, name, organizationId, description, price, dueDate, imageUrl, parent1Child1sItems, parent1Child2sItems, parent1ListsItems, srcSnapshotRaw);
  } else {
    await addParent1(userId, name, organizationId, description, price, dueDate, imageUrl, parent1Child1sItems, parent1Child2sItems, parent1ListsItems);
  }

  redirect('/parent1');
}
export async function removeParent1(ids: string[]) {
  const [{ permissions: userPermissions, userId }, parent1s] = await Promise.all([
    getModelPermissions('parent1'),
    await prisma.parent1.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredParent1s = userPermissions.general.delete
    ? parent1s
    : parent1s.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredParent1s.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteParent1(filteredParent1s.map(item => item.id));
  redirect('/parent1');
}

