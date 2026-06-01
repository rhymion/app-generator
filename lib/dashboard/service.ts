import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'dashboard'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    widgets: normalizeChildRefs(safeSnapshot.widgets),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.dashboard.findUnique({
    where: { id },
    include: {
      widgets: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addDashboard(actorId: string, name: string, widgetsItems: { name: string; entity_name: string; chart_type: number; stack_mode: number | null; series_field: string | null; group_by_bucket: number | null; group_by_field: string; filter_field: string | null; filter_value: string | null; order: number }[]): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
    });
    const created = await tx.dashboard.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        name: name,
      widgets: {
        create: widgetsItems.map(f => ({
          name: f.name,
          entity_name: f.entity_name,
          chart_type: f.chart_type,
          stack_mode: f.stack_mode,
          series_field: f.series_field,
          group_by_bucket: f.group_by_bucket,
          group_by_field: f.group_by_field,
          filter_field: f.filter_field,
          filter_value: f.filter_value,
          order: f.order,
        })),
      },
      },
    });
    await afterCreate(tx, created as Record<string, unknown>, {
      name: name,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateDashboard(actorId: string, id: string, name: string, widgetsItems: { id?: string; name: string; entity_name: string; chart_type: number; stack_mode: number | null; series_field: string | null; group_by_bucket: number | null; group_by_field: string; filter_field: string | null; filter_value: string | null; order: number }[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
    });
    await tx.dashboard.update({
      where: { id },
      data: {
        updater_id: actorId,
        name: name,
      widgets: {
        deleteMany: { id: { notIn: widgetsItems.map(f => f.id).filter((id): id is string => Boolean(id)) } },
        update: widgetsItems.filter(f => f.id).map(f => ({
          where: { id: f.id! },
          data: {
          name: f.name,
          entity_name: f.entity_name,
          chart_type: f.chart_type,
          stack_mode: f.stack_mode,
          series_field: f.series_field,
          group_by_bucket: f.group_by_bucket,
          group_by_field: f.group_by_field,
          filter_field: f.filter_field,
          filter_value: f.filter_value,
          order: f.order,
          },
        })),
        create: widgetsItems.filter(f => !f.id).map(f => ({
          name: f.name,
          entity_name: f.entity_name,
          chart_type: f.chart_type,
          stack_mode: f.stack_mode,
          series_field: f.series_field,
          group_by_bucket: f.group_by_bucket,
          group_by_field: f.group_by_field,
          filter_field: f.filter_field,
          filter_value: f.filter_value,
          order: f.order,
        })),
      },
      },
    });
  });
}
export async function deleteDashboard(ids: string[]): Promise<void> {
  await prisma.dashboard.deleteMany({ where: { id: { in: ids } } });
}
