import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/authz';
import { listNotifications, unreadCount } from '@/lib/_notifier';

/**
 * GET /api/notifications
 *
 * Returns the current user's notification list (newest first) and unread
 * count. Authenticated via session (NextAuth), not API key — this endpoint
 * powers the in-app bell, not external integrations.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    items: listNotifications(userId),
    unread: unreadCount(userId),
  });
}
