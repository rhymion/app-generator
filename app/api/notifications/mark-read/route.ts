import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/authz';
import { markAllRead } from '@/lib/_notifier';

/**
 * POST /api/notifications/mark-read
 *
 * Marks every notification for the current user as read. Simpler than
 * per-id mark-read for the bell UX (the dropdown shows everything at once,
 * so opening it = "I've seen them").
 */
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const changed = await markAllRead(userId);
  return NextResponse.json({ changed });
}
