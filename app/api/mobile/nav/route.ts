import { NextRequest, NextResponse } from 'next/server';
import { authenticate, handleApiError } from '@/lib/api-auth';
import { canAccess } from '@/lib/authz';
import { siteConfig } from '@/lib/site-config';
import prisma from '@/lib/prisma';
import { SCHEDULED_TASK_ROLE_NAME } from '@/lib/scheduled-tasks/system-actor';

/**
 * GET /api/mobile/nav — the nav hrefs the caller may NOT open.
 *
 * Applies the same rule as the desktop sidebar (app/[locale]/layout.tsx): an
 * entity link is hidden when the caller lacks `read` on its model, the
 * scheduled-task admin link is gated by the operator role, and the home and
 * external links are never hidden. Returning the hidden set (rather than the
 * visible one) keeps the mobile app correct for links it does not know about.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticate(request);
    const entityLinks = siteConfig.navLinks.filter((l) => !('external' in l && l.external) && l.href !== '/');
    const readable = await Promise.all(
      entityLinks.map(async (l) =>
        l.href === '/scheduled_task_run'
          ? (await prisma.role.count({
              where: { name: SCHEDULED_TASK_ROLE_NAME, users: { some: { id: userId } } },
            })) > 0
          : canAccess(l.href.slice(1), 'read', userId),
      ),
    );
    const hiddenHrefs = entityLinks.filter((_, i) => !readable[i]).map((l) => l.href);
    return NextResponse.json({ hiddenHrefs });
  } catch (error) {
    return handleApiError(error);
  }
}
