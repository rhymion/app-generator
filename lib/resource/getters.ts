'use server';

import prisma from '@/lib/prisma';
import type { Resource, ResourceDetail } from '@/lib/resource/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';
import { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';

export async function getAllResources(): Promise<Resource[]> {
  const associatedOrganizations = await getAssociatedOrganizationListPageData();
  const associatedOrganizationIds = associatedOrganizations.organizations.map((organization) => organization.id);

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
    organization: resource.organization,
  }));
}

export async function getResourceDetail(id: string): Promise<ResourceDetail | null> {
    const associatedOrganizations = await getAssociatedOrganizationListPageData();
  const associatedOrganizationIds = associatedOrganizations.organizations.map((organization) => organization.id);

  const resource = await prisma.resource.findFirst({
    where: { 
      id,
      organization_id: { in: associatedOrganizationIds },
    },
    include: { 
      resource_attachments: true, 
      resource_images: true, 
      organization: true, 
      creator: { select: { id: true, 
      name: true } }, 
      updater: { select: { id: true, 
      name: true } } 
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
  const userPermissions = await getModelPermissions('resource');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'resource');
  }
  const resources = await getAllResources();
  return { resources, userPermissions };
}

export async function getResourceDetailPageData(id: string, operation: Operation = 'read') {
  const userPermissions = await getModelPermissions('resource');
  await assertPermission(userPermissions, operation, 'resource');
  const resource = await getResourceDetail(id);
  return { resource, userPermissions };
}

export async function getResourceNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('resource');
  await assertPermission(userPermissions, 'create', 'resource');
  return userPermissions;
}
