'use server';

import prisma from '@/lib/prisma';
import type { Comment } from '@/lib/comment/types';

export async function searchCommentOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Comment[]> {
  const trimmed = query.trim();
  const orClauses: Record<string, unknown>[] = [];
  if (trimmed) {
    orClauses.push({ message: { contains: trimmed, mode: 'insensitive' } });
  }
  if (includeIds.length > 0) {
    orClauses.push({ id: { in: includeIds } });
  }

  const where = orClauses.length > 0 ? { OR: orClauses } : {};
  const rows = await prisma.comment.findMany({
    where,
    orderBy: { created_at: 'asc' },
    take: limit,
    select: {
      id: true,
      message: true,
      commentable_id: true,
      creator_id: true,
      created_at: true,
      updated_at: true,
    },
  });
  return rows;
}
