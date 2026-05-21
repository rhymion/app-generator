'use server';

import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';
import { auth } from '@/auth';
import { assertPermission, getModelPermissions, getSessionUserIdOrThrow, Operation, resolvePermissions, toPermissions } from '../authz';

export async function getAssociatedOrganizations(userId: string): Promise<Organization[]> {
  const organizations = await prisma.organization.findMany({
    where: {
      users: {
        some: {
          id: userId
        }
      }
    },
  });
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    description: organization.description,
    creator_id: organization.creator_id,
  }));
}

export async function getAssociatedOrganizationDetail(id: string, userId: string): Promise<OrganizationDetail | null> {
  const organization = await prisma.organization.findUnique({
    where: { 
      id,
      users: {
        some: {
          id: userId
        }
      }
    },
    include: { 
      users: {
        where: { id: userId }
      }
    },
  });

  if (!organization) {
    return null;
  }

  return {
    ...organization,
    users: organization.users,
  };
}

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
  const resolved = await resolvePermissions(basePermissions, organization, userId ?? '');
  await assertPermission(resolved, operation, 'organization');
  return { organization, userPermissions: await toPermissions(resolved) };
}
