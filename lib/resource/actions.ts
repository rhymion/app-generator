'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addResource, updateResource, deleteResource } from './service';

export async function upsertResource(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('resource', 'update');
  } else {
    await requirePermission('resource', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const organizationId = data.get('organization_id') as string;
  const resourceAttachmentsRaw = data.getAll('resource_attachment[]') as string[];
  const resourceAttachmentsItems = resourceAttachmentsRaw.map(f => JSON.parse(f) as { id?: string; order: number; name: string; path: string });
  const resourceImagesRaw = data.getAll('resource_image[]') as string[];
  const resourceImagesItems = resourceImagesRaw.map(f => JSON.parse(f) as { id?: string; name: string; path: string });
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateResource(userId, id, name, description, organizationId, resourceAttachmentsItems, resourceImagesItems, srcSnapshotRaw);
  } else {
    await addResource(userId, name, description, organizationId, resourceAttachmentsItems, resourceImagesItems);
  }

  revalidatePath('/');
  redirect('/resource');
}

export async function removeResource(data: FormData | string[]) {
  await requirePermission('resource', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteResource(ids);
  revalidatePath('/');
  redirect('/resource');
}
