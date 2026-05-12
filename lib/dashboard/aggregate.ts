'use server';

import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow } from '@/lib/authz';
import { findDashboardEntity, findDashboardField } from './catalog';

export type AggregateBucket = { label: string; count: number };

export type AggregateFilter = { field: string; value: string } | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrismaModel = { groupBy: (args: any) => Promise<any[]>; findMany: (args: any) => Promise<any[]> };

function getModelClient(name: string): AnyPrismaModel {
  // entity_name is validated against the static catalog before this is called,
  // so the dynamic lookup is safe; the cast keeps the surface narrow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = (prisma as any)[name] as AnyPrismaModel | undefined;
  if (!client) throw new Error(`Prisma model '${name}' not found`);
  return client;
}

export async function aggregateForWidget(
  entityName: string,
  groupByField: string,
  filter: AggregateFilter = null,
): Promise<AggregateBucket[]> {
  await getSessionUserIdOrThrow();

  const entity = findDashboardEntity(entityName);
  if (!entity) throw new Error(`Entity '${entityName}' is not dashboardable`);
  const field = findDashboardField(entityName, groupByField);
  if (!field) throw new Error(`Field '${groupByField}' is not groupable on '${entityName}'`);

  const where = filter && filter.field && filter.value ? { [filter.field]: filter.value } : undefined;

  const rows = await getModelClient(entityName).groupBy({
    by: [groupByField],
    _count: { id: true },
    where,
  });

  if (field.kind === 'boolean') {
    return rows.map((r) => ({
      label: r[groupByField] ? 'Yes' : 'No',
      count: r._count.id,
    }));
  }

  if (field.kind === 'enum') {
    return rows.map((r) => {
      const idx = r[groupByField] as number;
      const label = field.enum_values[idx] ?? String(idx);
      return { label, count: r._count.id };
    });
  }

  // FK
  const fkIds = rows
    .map((r) => r[groupByField])
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const labelById = new Map<string, string>();
  if (fkIds.length > 0) {
    const targets = await getModelClient(field.fk_target).findMany({
      where: { id: { in: fkIds } },
      select: { id: true, [field.fk_label_field]: true },
    });
    for (const t of targets as Array<Record<string, unknown>>) {
      labelById.set(String(t.id), String(t[field.fk_label_field] ?? '(unnamed)'));
    }
  }
  return rows.map((r) => ({
    label: r[groupByField] == null ? '(unspecified)' : labelById.get(String(r[groupByField])) ?? '(unknown)',
    count: r._count.id,
  }));
}
