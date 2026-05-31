'use server';

import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow } from '@/lib/authz';
import { findDashboardEntity, findDashboardField, DashboardField } from './catalog';

export type AggregateBucket = { label: string; count: number };

// Legacy single-field filter kept for back-compat callers.
export type AggregateFilter = { field: string; value: string } | null;

export type FilterCondition = {
  field: string;
  operator:
    | 'equals' | 'in' | 'contains' | 'not'    // string / enum
    | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'  // number
    | 'before' | 'after' | 'onOrBefore' | 'onOrAfter'          // datetime
    | 'is';                                                      // boolean
  values: (string | number | boolean)[];
};

// Discriminated union: single-dimension vs category × series matrix
export type AggregateOutput =
  | { kind: 'single'; data: AggregateBucket[] }
  | { kind: 'multi'; categories: string[]; series: { label: string; data: number[] }[] };

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

// Translate a single FilterCondition to a Prisma where clause fragment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildConditionWhere(condition: FilterCondition): Record<string, any> {
  const { field, operator, values } = condition;
  const v0 = values[0];
  switch (operator) {
    case 'equals':
    case 'eq':
      return { [field]: { equals: v0 } };
    case 'neq':
      return { [field]: { not: v0 } };
    case 'not':
      return { [field]: { not: v0 } };
    case 'gt':
    case 'after':
      return { [field]: { gt: v0 } };
    case 'gte':
    case 'onOrAfter':
      return { [field]: { gte: v0 } };
    case 'lt':
    case 'before':
      return { [field]: { lt: v0 } };
    case 'lte':
    case 'onOrBefore':
      return { [field]: { lte: v0 } };
    case 'between':
      return { [field]: { gte: values[0], lte: values[1] } };
    case 'in':
      return { [field]: { in: values } };
    case 'contains':
      return { [field]: { contains: v0, mode: 'insensitive' } };
    case 'is':
      return { [field]: { equals: v0 } };
    default:
      return { [field]: { equals: v0 } };
  }
}

// Build combined Prisma where from a conditions array (AND-combined).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildConditionsWhere(conditions: FilterCondition[]): Record<string, any> | undefined {
  if (!conditions.length) return undefined;
  if (conditions.length === 1) return buildConditionWhere(conditions[0]);
  return { AND: conditions.map(buildConditionWhere) };
}

// Resolve raw field values to display labels; performs async FK lookup when needed.
async function buildLabelMap(
  field: DashboardField,
  rawValues: unknown[],
): Promise<Map<string, string>> {
  if (field.kind === 'boolean') {
    return new Map(rawValues.map((v) => [String(v), v ? 'Yes' : 'No']));
  }
  if (field.kind === 'enum') {
    return new Map(
      rawValues.map((v) => {
        const idx = v as number;
        return [String(v), field.enum_values[idx] ?? String(idx)];
      }),
    );
  }
  if (field.kind === 'number' || field.kind === 'datetime') {
    return new Map(rawValues.map((v) => [String(v), String(v)]));
  }
  // FK: batch-fetch labels from the target model
  const ids = rawValues.filter((v): v is string => typeof v === 'string' && v.length > 0);
  const targets = await getModelClient(field.fk_target).findMany({
    where: { id: { in: ids } },
    select: { id: true, [field.fk_label_field]: true },
  });
  const map = new Map<string, string>();
  for (const t of targets as Array<Record<string, unknown>>) {
    map.set(String(t.id), String(t[field.fk_label_field] ?? '(unnamed)'));
  }
  return map;
}

// Convert a raw value to a display string using a pre-built label map.
function applyLabel(labelMap: Map<string, string>, raw: unknown): string {
  if (raw == null) return '(unspecified)';
  return labelMap.get(String(raw)) ?? String(raw);
}

// Two-dimensional groupBy: category_field × series_field → multi-series matrix.
async function aggregateMultiSeries(
  entityName: string,
  catField: DashboardField,
  serField: DashboardField,
  where: Record<string, unknown> | undefined,
): Promise<{ kind: 'multi'; categories: string[]; series: { label: string; data: number[] }[] }> {
  const rows = await getModelClient(entityName).groupBy({
    by: [catField.name, serField.name],
    _count: { id: true },
    where,
  });

  // Collect unique raw values in stable insertion order
  const rawCatSet: unknown[] = [];
  const rawSerSet: unknown[] = [];
  for (const r of rows) {
    if (!rawCatSet.includes(r[catField.name])) rawCatSet.push(r[catField.name]);
    if (!rawSerSet.includes(r[serField.name])) rawSerSet.push(r[serField.name]);
  }

  const [catLabels, serLabels] = await Promise.all([
    buildLabelMap(catField, rawCatSet),
    buildLabelMap(serField, rawSerSet),
  ]);

  const categories = rawCatSet.map((v) => applyLabel(catLabels, v));

  const series = rawSerSet.map((sv) => {
    const seriesLabel = applyLabel(serLabels, sv);
    const data = rawCatSet.map((cv) => {
      const row = rows.find(
        (r) => r[catField.name] === cv && r[serField.name] === sv,
      );
      return row ? (row._count.id as number) : 0;
    });
    return { label: seriesLabel, data };
  });

  return { kind: 'multi', categories, series };
}

export async function aggregateForWidget(
  entityName: string,
  groupByField: string,
  filter: AggregateFilter = null,
  seriesField?: string,
  conditions?: FilterCondition[],
): Promise<AggregateOutput> {
  await getSessionUserIdOrThrow();

  const entity = findDashboardEntity(entityName);
  if (!entity) throw new Error(`Entity '${entityName}' is not dashboardable`);
  const field = findDashboardField(entityName, groupByField);
  if (!field) throw new Error(`Field '${groupByField}' is not groupable on '${entityName}'`);

  // Build where clause: conditions[] takes precedence over legacy filter.
  let where: Record<string, unknown> | undefined;
  if (conditions && conditions.length > 0) {
    where = buildConditionsWhere(conditions);
  } else if (filter && filter.field && filter.value) {
    // Back-compat: legacy single filter treated as equals condition.
    where = { [filter.field]: filter.value };
  }

  // 2D aggregation when series_field is specified
  if (seriesField) {
    const serField = findDashboardField(entityName, seriesField);
    if (!serField) throw new Error(`Field '${seriesField}' is not groupable on '${entityName}'`);
    return aggregateMultiSeries(entityName, field, serField, where);
  }

  // Single-dimension aggregation (original behaviour)
  const rows = await getModelClient(entityName).groupBy({
    by: [groupByField],
    _count: { id: true },
    where,
  });

  if (field.kind === 'boolean') {
    return {
      kind: 'single',
      data: rows.map((r) => ({
        label: r[groupByField] ? 'Yes' : 'No',
        count: r._count.id,
      })),
    };
  }

  if (field.kind === 'enum') {
    return {
      kind: 'single',
      data: rows.map((r) => {
        const idx = r[groupByField] as number;
        const label = field.enum_values[idx] ?? String(idx);
        return { label, count: r._count.id };
      }),
    };
  }

  if (field.kind === 'number' || field.kind === 'datetime') {
    return {
      kind: 'single',
      data: rows.map((r) => ({
        label: r[groupByField] == null ? '(unspecified)' : String(r[groupByField]),
        count: r._count.id,
      })),
    };
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
  return {
    kind: 'single',
    data: rows.map((r) => ({
      label: r[groupByField] == null ? '(unspecified)' : labelById.get(String(r[groupByField])) ?? '(unknown)',
      count: r._count.id,
    })),
  };
}
