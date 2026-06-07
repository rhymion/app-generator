'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { notify } from '@/lib/_notifier';
import { COMMENT_REACTION_TYPES } from '@/lib/reaction_constants';
import type { CommentReactionSummary } from './types';
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
  const fieldsItems = fieldsRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string; reference_id: string | null; max_length: number; max: number | null; regex: string | null; required: boolean });
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateDbTable(actorId, id, name, description, fieldsItems, srcSnapshotRaw);
  } else {
    await addDbTable(actorId, name, description, fieldsItems);
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
  revalidatePath('/[locale]/db_table', 'page');
  redirect('/db_table');
}

export async function addDbTableComment(commentable_id: string, message: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  await prisma.comment.create({
    data: { message, commentable_id, creator_id: userId },
  });
  // Trigger #4 (notification design 2026-05-11): notify the entity creator
  // and (if present) assignee; never the commenter themselves.
  const parentRow = await prisma.db_table.findFirst({
    where: { commentable_id },
    select: { id: true, creator_id: true },
  });
  if (parentRow) {
    const recipients = new Set<string>(
      [parentRow.creator_id].filter((id): id is string => Boolean(id) && id !== userId)
    );
    for (const recipientId of recipients) {
      notify(recipientId, 'comment_created', {
        title: 'New comment on DbTable',
        href: `/db_table/view/${parentRow.id}`,
        commentSnippet: message.slice(0, 80),
      });
    }
  }
  revalidatePath('/db_table');
}

export async function updateDbTableComment(commentId: string, message: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { creator_id: true } });
  if (!comment || comment.creator_id !== userId) {
    throw new Error('Not authorized to edit this comment');
  }
  await prisma.comment.update({ where: { id: commentId }, data: { message } });
  revalidatePath('/db_table');
}

export async function deleteDbTableComment(commentId: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { creator_id: true } });
  if (!comment) return;
  if (comment.creator_id !== userId) {
    await requirePermission('db_table', 'delete');
  }
  await prisma.comment.delete({ where: { id: commentId } });
  revalidatePath('/db_table');
}

export async function toggleDbTableCommentReaction(
  commentId: string,
  type: number
): Promise<CommentReactionSummary> {
  const userId = await getSessionUserIdOrThrow();
  const validTypes: number[] = COMMENT_REACTION_TYPES.map((t) => t.value);
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid reaction type: ${type}`);
  }
  // D7=B: require read permission on the parent entity that owns the comment
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { commentable_id: true },
  });
  if (!comment) throw new Error('Comment not found');
  const parentRow = await prisma.db_table.findFirst({
    where: { commentable_id: comment.commentable_id },
    select: { id: true, creator_id: true },
  });
  await requirePermission('db_table', 'read', parentRow ?? undefined);

  const existing = await prisma.reaction.findUnique({
    where: { comment_id_user_id_type: { comment_id: commentId, user_id: userId, type } },
  });
  let active: boolean;
  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
    active = false;
  } else {
    await prisma.reaction.create({ data: { comment_id: commentId, user_id: userId, type } });
    active = true;
  }

  const rawCounts = await prisma.reaction.groupBy({
    by: ['type'],
    where: { comment_id: commentId },
    _count: { type: true },
  });
  const counts = rawCounts.map((r) => ({ type: r.type, count: r._count.type }));
  const myReactions = await prisma.reaction.findMany({
    where: { comment_id: commentId, user_id: userId },
    select: { type: true },
  });
  const myTypes = myReactions.map((r) => r.type);

  return { commentId, type, active, counts, myTypes };
}
