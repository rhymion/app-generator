// Test-only route, copied into the disposable build copy by the gate script and never generated.
// A stand-in for a hand-written route: it renames an sx_account row through the wrappers a
// contributor is told to use (authenticate, the permission check, the organization-scoped lookup).
//   PATCH /api/sx_account/{id}/rename_probe    Body: { name: string }
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireApiPermission, handleApiError, ApiError } from '@/lib/api-auth';
import { resolveRecordPermissions } from '@/lib/authz';
import { getAssociatedOrganizations } from '@/lib/organization/associated_internal';
import prisma from '@/lib/prisma';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticate(request);
    const basePerms = await requireApiPermission(actorId, 'sx_account', 'update');
    const organizationIds = (await getAssociatedOrganizations(actorId)).map((o) => o.id);
    const existing = await prisma.sx_account.findFirst({
      where: { id, organization_id: { in: organizationIds } },
      select: { id: true, creator_id: true, assignee_id: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const resolved = await resolveRecordPermissions(basePerms, existing, actorId);
    if (!resolved.update) throw new ApiError(403, 'Access denied: sx_account.update');
    const { name } = (await request.json()) as { name: string };
    const updated = await prisma.sx_account.update({ where: { id }, data: { name } });
    return NextResponse.json({ id: updated.id, name: updated.name });
  } catch (error) {
    return handleApiError(error);
  }
}
