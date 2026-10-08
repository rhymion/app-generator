import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/authz';
import { authenticate, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { INBOX_CAP, TTL_MS, type Notification } from '@/lib/_notifier';

/**
 * GET /api/notifications
 *
 * Returns the current user's notification list (newest first) and unread
 * count. Authenticated via the NextAuth session cookie, or via an
 * `Authorization: Bearer` mobile access token when that header is present —
 * this endpoint powers the in-app bell (web and mobile), not external
 * integrations.
 *
 * Reads the `notification` table directly (not the in-process store in
 * `lib/_notifier.ts`) so the result is correct regardless of which server
 * instance/process handled the write — see the module doc in
 * `lib/_notifier.ts` for why the in-process Map alone is not enough.
 */
export async function GET(request: NextRequest) {
  let userId: string | null;
  if (request.headers.get('Authorization')) {
    try {
      userId = (await authenticate(request)).userId;
    } catch (error) {
      return handleApiError(error);
    }
  } else {
    userId = await getSessionUserId();
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - TTL_MS);
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { user_id: userId, created_at: { gte: cutoff } },
      orderBy: { created_at: 'desc' },
      take: INBOX_CAP,
    }),
    prisma.notification.count({
      where: { user_id: userId, read: false, created_at: { gte: cutoff } },
    }),
  ]);

  const items: Notification[] = rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    type: row.type,
    payload: row.payload as Notification['payload'],
    createdAt: row.created_at.getTime(),
    read: row.read,
  }));

  return NextResponse.json({ items, unread });
}
