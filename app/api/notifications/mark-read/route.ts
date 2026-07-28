import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/authz';
import prisma from '@/lib/prisma';

/**
 * POST /api/notifications/mark-read
 *
 * Marks every notification for the current user as read. Simpler than
 * per-id mark-read for the bell UX (the dropdown shows everything at once,
 * so opening it = "I've seen them").
 *
 * Updates the `notification` table directly — see `lib/_notifier.ts` module
 * doc for why the DB (not the in-process store) is the source of truth.
 */
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await prisma.notification.updateMany({
    where: { user_id: userId, read: false },
    data: { read: true },
  });
  return NextResponse.json({ changed: result.count });
}
