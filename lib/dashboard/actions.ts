'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addDashboard, updateDashboard, deleteDashboard } from './service';
export async function upsertDashboard(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.dashboard.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('dashboard', 'update', existing);
  } else {
    await requirePermission('dashboard', 'create');
  }
  const name = data.get('name') as string;
  const widgetsRaw = data.getAll('widget[]') as string[];
  const widgetsItems = widgetsRaw.map(f => JSON.parse(f) as { id?: string; name: string; entity_name: string; chart_type: number; stack_mode: number | null; series_field: string | null; group_by_bucket: number | null; group_by_field: string; filter_field: string | null; filter_value: string | null; order: number });
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateDashboard(actorId, id, name, widgetsItems, srcSnapshotRaw);
  } else {
    await addDashboard(actorId, name, widgetsItems);
  }

  redirect('/dashboard');
}
export async function removeDashboard(ids: string[]) {
  const [{ permissions: userPermissions, userId }, dashboards] = await Promise.all([
    getModelPermissions('dashboard'),
    await prisma.dashboard.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredDashboards = userPermissions.general.delete
    ? dashboards
    : dashboards.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredDashboards.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteDashboard(filteredDashboards.map(item => item.id));
  revalidatePath('/[locale]/dashboard', 'page');
  redirect('/dashboard');
}

