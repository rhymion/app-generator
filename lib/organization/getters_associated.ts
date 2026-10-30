'use server';

import prisma from '@/lib/prisma';
import type { Organization } from '@/lib/organization/types';
import { getAssociatedOrganizationDetail } from '@/lib/organization/associated_internal';
import { assertPermission, getModelPermissions, getSessionUserIdOrThrow, Operation, resolveEntityPermissions, resolveRecordPermissions, toPermissions } from '../authz';

/**
 * Lightweight search for the organization autocomplete picker. Restricted to
 * organizations the user is a member of (mirrors getAssociatedOrganizations);
 * matches `query` against name and includes any rows in `includeIds` so the
 * currently-selected option is always present.
 */
export async function searchAssociatedOrganizationOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Organization[]> {
  const userId = await getSessionUserIdOrThrow();
  const { permissions } = await getModelPermissions('organization', userId);
  await assertPermission(permissions, 'read', 'organization');

  const trimmed = query.trim();
  const orClauses: Record<string, unknown>[] = [];
  if (trimmed) {
    orClauses.push({ name: { contains: trimmed, mode: 'insensitive' } });
  }
  if (includeIds.length > 0) {
    orClauses.push({ id: { in: includeIds } });
  }
  const where: Record<string, unknown> = {
    users: { some: { id: userId } },
  };
  if (orClauses.length > 0) {
    where.OR = orClauses;
  }
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 200);
  const rows = await prisma.organization.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
  });
  return rows.map((organization) => ({
    id: organization.id,
    name: organization.name,
    description: organization.description,
    creator_id: organization.creator_id,
  }));
}

export async function getAssociatedOrganizationDetailPageData(id: string, operation: Operation = 'read') {
  const userId = await getSessionUserIdOrThrow();
  const [organization, { permissions: basePermissions }] = await Promise.all([
    getAssociatedOrganizationDetail(id, userId),
    getModelPermissions('organization', userId),
  ]);
  const resolved = organization
    ? await resolveRecordPermissions(basePermissions, organization, userId)
    : await resolveEntityPermissions(basePermissions);
  await assertPermission(resolved, operation, 'organization');
  return { organization, userPermissions: await toPermissions(resolved) };
}
