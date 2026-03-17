'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addResource, updateResource, deleteResource } from './service';
export async function upsertResource(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.resource.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('resource', 'update', existing);
  } else {
    await requirePermission('resource', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const organizationId = data.get('organization_id') as string;
  const resourceAttachmentsRaw = data.getAll('resource_attachment[]') as string[];
  const resourceAttachmentsItems = resourceAttachmentsRaw.map(f => JSON.parse(f) as { order: number; name: string; path: string });
  const resourceImagesRaw = data.getAll('resource_image[]') as string[];
  const resourceImagesItems = resourceImagesRaw.map(f => JSON.parse(f) as { name: string; path: string });
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateResource(userId, id, name, description, organizationId, resourceAttachmentsItems, resourceImagesItems, srcSnapshotRaw);
  } else {
    await addResource(userId, name, description, organizationId, resourceAttachmentsItems, resourceImagesItems);
  }

  redirect('/resource');
}
export async function removeResource(ids: string[]) {
  const [{ permissions: userPermissions, userId }, resources] = await Promise.all([
    getModelPermissions('resource'),
    await prisma.resource.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredResources = userPermissions.general.delete
    ? resources
    : resources.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredResources.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteResource(filteredResources.map(item => item.id));
  redirect('/resource');
}

