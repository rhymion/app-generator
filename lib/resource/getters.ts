'use server';

import prisma from '@/lib/prisma';
import type { Resource, ResourceDetail } from '@/lib/resource/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions, getSessionUserIdOrThrow } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';

export async function getAllResources(userId: string): Promise<Resource[]> {
  const associatedOrganizations = await getAssociatedOrganizations(userId);
  const associatedOrganizationIds = associatedOrganizations.map((organization) => organization.id);
  const resources = await prisma.resource.findMany({
    where: {
      organization_id: { in: associatedOrganizationIds },
    },
    include: { organization: true },
  });
  return resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    description: resource.description,
    organization_id: resource.organization_id,
    creator_id: resource.creator_id,
    organization: resource.organization,
  }));
}

export async function getResourceDetail(id: string, userId: string): Promise<ResourceDetail | null> {
  const associatedOrganizations = await getAssociatedOrganizations(userId);
  const associatedOrganizationIds = associatedOrganizations.map((organization) => organization.id);
  const resource = await prisma.resource.findFirst({
    where: {
      id,
      organization_id: { in: associatedOrganizationIds },
    },
    include: {
      resource_attachments: true, resource_images: true, organization: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!resource) {
    return null;
  }

  return {
    ...resource,
    resource_attachments: resource.resource_attachments,
    resource_images: resource.resource_images,
    organization: resource.organization,
  };
}

export async function getResourceListPageData(isAssertPermission: boolean = true) {
  const userId = await getSessionUserIdOrThrow();
  const [{ permissions: userPermissions }, resources] = await Promise.all([
    getModelPermissions('resource', userId),
    getAllResources(userId),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'resource');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredResources = userPermissions.general.read
    ? resources
    : resources.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { resources: filteredResources, userPermissions: await toPermissions(userPermissions) };
}

export async function getResourceDetailPageData(id: string, operation: Operation = 'read') {
  const userId = await getSessionUserIdOrThrow();
  const [resource, { permissions: basePermissions }] = await Promise.all([
    getResourceDetail(id, userId),
    getModelPermissions('resource', userId),
  ]);
  const resolved = await resolvePermissions(basePermissions, resource, userId ?? '');
  await assertPermission(resolved, operation, 'resource');
  return { resource, userPermissions: await toPermissions(resolved) };
}

export async function getResourceNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('resource');
  await assertPermission(richPermissions.general, 'create', 'resource');
  return richPermissions.general;
}
