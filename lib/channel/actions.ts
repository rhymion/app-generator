'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { notify } from '@/lib/_notifier';
import { COMMENT_REACTION_TYPES } from '@/lib/reaction_constants';
import type { CommentReactionSummary } from './types';
import { addChannel, updateChannel, deleteChannel } from './service';
export async function upsertChannel(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.channel.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('channel', 'update', existing);
  } else {
    await requirePermission('channel', 'create');
  }
  const name = data.get('name') as string;
  const kind = Number(data.get('kind'));
  const organizationId = data.get('organization_id') as string;
  const selectedParentType = data.get('selectedParentType') as string;
  const selectedParentId = data.get('selectedParentId') as string;
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateChannel(actorId, id, name, kind, organizationId, srcSnapshotRaw);
  } else {
    await addChannel(actorId, name, kind, organizationId, selectedParentType, selectedParentId);
  }

  redirect('/channel');
}
export async function removeChannel(ids: string[]) {
  const [{ permissions: userPermissions, userId }, channels] = await Promise.all([
    getModelPermissions('channel'),
    await prisma.channel.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredChannels = userPermissions.general.delete
    ? channels
    : channels.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredChannels.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteChannel(filteredChannels.map(item => item.id));
  revalidatePath('/[locale]/channel', 'page');
  redirect('/channel');
}

export async function addChannelComment(commentable_id: string, message: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  await prisma.comment.create({
    data: { message, commentable_id, creator_id: userId },
  });
  // Trigger #4 (notification design 2026-05-11): notify the entity creator
  // and (if present) assignee; never the commenter themselves.
  const parentRow = await prisma.channel.findFirst({
    where: { commentable_id },
    select: { id: true, creator_id: true },
  });
  if (parentRow) {
    const recipients = new Set<string>(
      [parentRow.creator_id].filter((id): id is string => Boolean(id) && id !== userId)
    );
    for (const recipientId of recipients) {
      notify(recipientId, 'comment_created', {
        title: 'New comment on Channel',
        href: `/channel/view/${parentRow.id}`,
        commentSnippet: message.slice(0, 80),
      });
    }
  }
  revalidatePath('/channel');
}

export async function updateChannelComment(commentId: string, message: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { creator_id: true } });
  if (!comment || comment.creator_id !== userId) {
    throw new Error('Not authorized to edit this comment');
  }
  await prisma.comment.update({ where: { id: commentId }, data: { message } });
  revalidatePath('/channel');
}

export async function deleteChannelComment(commentId: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { creator_id: true } });
  if (!comment) return;
  if (comment.creator_id !== userId) {
    await requirePermission('channel', 'delete');
  }
  await prisma.comment.delete({ where: { id: commentId } });
  revalidatePath('/channel');
}

export async function toggleChannelCommentReaction(
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
  const parentRow = await prisma.channel.findFirst({
    where: { commentable_id: comment.commentable_id },
    select: { id: true, creator_id: true },
  });
  await requirePermission('channel', 'read', parentRow ?? undefined);

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
