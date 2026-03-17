'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addDbTable, updateDbTable, deleteDbTable } from './service';
export async function upsertDbTable(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.db_table.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('db_table', 'update', existing);
  } else {
    await requirePermission('db_table', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const fieldsRaw = data.getAll('field[]') as string[];
  const fieldsItems = fieldsRaw.map(f => JSON.parse(f) as { name: string; type: string; reference_id: string | null; max_length: number | null; max: number | null; regex: string | null; required: boolean });
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateDbTable(userId, id, name, description, fieldsItems, srcSnapshotRaw);
  } else {
    await addDbTable(userId, name, description, fieldsItems);
  }

  redirect('/db_table');
}
export async function removeDbTable(ids: string[]) {
  const [{ permissions: userPermissions, userId }, dbTables] = await Promise.all([
    getModelPermissions('db_table'),
    await prisma.db_table.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredDbTables = userPermissions.general.delete
    ? dbTables
    : dbTables.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredDbTables.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteDbTable(filteredDbTables.map(item => item.id));
  redirect('/db_table');
}

export async function addDbTableComment(db_table_id: string, message: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  await prisma.db_table_comment.create({
    data: { message, db_table_id, creator_id: userId },
  });
  revalidatePath('/db_table');
}

export async function updateDbTableComment(commentId: string, message: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.db_table_comment.findUnique({ where: { id: commentId }, select: { creator_id: true } });
  if (!comment || comment.creator_id !== userId) {
    throw new Error('Not authorized to edit this comment');
  }
  await prisma.db_table_comment.update({ where: { id: commentId }, data: { message } });
  revalidatePath('/db_table');
}

export async function deleteDbTableComment(commentId: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.db_table_comment.findUnique({ where: { id: commentId }, select: { creator_id: true } });
  if (!comment) return;
  if (comment.creator_id !== userId) {
    await requirePermission('db_table', 'delete');
  }
  await prisma.db_table_comment.delete({ where: { id: commentId } });
  revalidatePath('/db_table');
}
