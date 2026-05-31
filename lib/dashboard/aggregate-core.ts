// Core aggregation logic — no auth check. Caller is responsible for authentication
// and authorization. Used by both the 'use server' aggregateForWidget wrapper
// (session auth) and the REST API route (API-key auth).
import prisma from '@/lib/prisma';
import { Prisma } from '@/app/generated/prisma/client';
import { findDashboardEntity, findDashboardField, DashboardField } from './catalog';

// Type definitions live here to avoid circular imports with aggregate.ts.
export type AggregateBucket = { label: string; count: number };
export type AggregateFilter = { field: string; value: string } | null;
export type BucketGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type FilterCondition = {
  field: string;
  operator:
    | 'equals' | 'in' | 'contains' | 'not'    // string / enum
    | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'  // number
    | 'before' | 'after' | 'onOrBefore' | 'onOrAfter'          // datetime
    | 'is';                                                      // boolean
  values: (string | number | boolean)[];
};

export type AggregateOutput =
  | { kind: 'single'; data: AggregateBucket[] }
  | { kind: 'multi'; categories: string[]; series: { label: string; data: number[] }[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrismaModel = { groupBy: (args: any) => Promise<any[]>; findMany: (args: any) => Promise<any[]> };

function getModelClient(name: string): AnyPrismaModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = (prisma as any)[name] as AnyPrismaModel | undefined;
  if (!client) throw new Error(`Prisma model '${name}' not found`);
  return client;
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildConditionsWhere(conditions: FilterCondition[]): Record<string, any> | undefined {
  if (!conditions.length) return undefined;
  if (conditions.length === 1) return buildConditionWhere(conditions[0]);
  return { AND: conditions.map(buildConditionWhere) };
}

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

function applyLabel(labelMap: Map<string, string>, raw: unknown): string {
  if (raw == null) return '(unspecified)';
  return labelMap.get(String(raw)) ?? String(raw);
}

function formatBucketLabel(date: Date, bucket: BucketGranularity): string {
  const iso = new Date(date).toISOString();
  switch (bucket) {
    case 'day': return iso.slice(0, 10);
    case 'week': return iso.slice(0, 10);
    case 'month': return iso.slice(0, 7);
    case 'quarter': {
      const d = new Date(date);
      return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    }
    case 'year': return String(new Date(date).getUTCFullYear());
  }
}

function sameBucket(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}

function conditionToSql(condition: FilterCondition): Prisma.Sql {
  const col = Prisma.raw(`"${condition.field}"`);
  const v0 = condition.values[0];
  switch (condition.operator) {
    case 'equals': case 'eq':
      return Prisma.sql`${col} = ${v0}`;
    case 'neq': case 'not':
      return Prisma.sql`${col} != ${v0}`;
    case 'gt': case 'after':
      return Prisma.sql`${col} > ${v0}`;
    case 'gte': case 'onOrAfter':
      return Prisma.sql`${col} >= ${v0}`;
    case 'lt': case 'before':
      return Prisma.sql`${col} < ${v0}`;
    case 'lte': case 'onOrBefore':
      return Prisma.sql`${col} <= ${v0}`;
    case 'between':
      return Prisma.sql`${col} BETWEEN ${condition.values[0]} AND ${condition.values[1]}`;
    case 'in':
      return Prisma.sql`${col} IN (${Prisma.join(condition.values.map((v) => Prisma.sql`${v}`))})`;
    case 'contains':
      return Prisma.sql`lower(${col}::text) LIKE lower(${`%${v0}%`})`;
    case 'is':
      return Prisma.sql`${col} = ${v0}`;
    default:
      return Prisma.sql`${col} = ${v0}`;
  }
}

function buildSqlWhere(conditions: FilterCondition[]): Prisma.Sql {
  if (conditions.length === 0) return Prisma.sql``;
  const fragments = conditions.map(conditionToSql);
  return Prisma.sql`WHERE ${Prisma.join(fragments, ' AND ')}`;
}

async function aggregateBucketSingle(
  entityName: string,
  fieldName: string,
  bucket: BucketGranularity,
  conditions: FilterCondition[],
): Promise<{ kind: 'single'; data: AggregateBucket[] }> {
  const table = Prisma.raw(`"${entityName}"`);
  const col = Prisma.raw(`"${fieldName}"`);
  const where = buildSqlWhere(conditions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await (prisma as any).$queryRaw(
    Prisma.sql`
      SELECT date_trunc(${bucket}, ${col}) AS bucket, COUNT(*) AS count
      FROM ${table}
      ${where}
      GROUP BY 1
      ORDER BY 1
    `,
  )) as Array<{ bucket: Date | null; count: bigint }>;
  return {
    kind: 'single',
    data: rows.map((r) => ({
      label: r.bucket ? formatBucketLabel(r.bucket, bucket) : '(unspecified)',
      count: Number(r.count),
    })),
  };
}

async function aggregateBucketMultiSeries(
  entityName: string,
  catField: DashboardField,
  serField: DashboardField,
  bucket: BucketGranularity,
  conditions: FilterCondition[],
): Promise<{ kind: 'multi'; categories: string[]; series: { label: string; data: number[] }[] }> {
  const table = Prisma.raw(`"${entityName}"`);
  const catCol = Prisma.raw(`"${catField.name}"`);
  const serCol = Prisma.raw(`"${serField.name}"`);
  const where = buildSqlWhere(conditions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await (prisma as any).$queryRaw(
    Prisma.sql`
      SELECT date_trunc(${bucket}, ${catCol}) AS bucket,
             ${serCol} AS series_val,
             COUNT(*) AS count
      FROM ${table}
      ${where}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
  )) as Array<{ bucket: Date | null; series_val: unknown; count: bigint }>;

  const rawBuckets: (Date | null)[] = [];
  const rawSerVals: unknown[] = [];
  for (const r of rows) {
    if (!rawBuckets.some((b) => sameBucket(b, r.bucket))) rawBuckets.push(r.bucket);
    if (!rawSerVals.includes(r.series_val)) rawSerVals.push(r.series_val);
  }

  const categories = rawBuckets.map((b) => (b ? formatBucketLabel(b, bucket) : '(unspecified)'));
  const serLabels = await buildLabelMap(serField, rawSerVals);

  const series = rawSerVals.map((sv) => ({
    label: applyLabel(serLabels, sv),
    data: rawBuckets.map((bv) => {
      const row = rows.find((r) => sameBucket(r.bucket, bv) && r.series_val === sv);
      return row ? Number(row.count) : 0;
    }),
  }));

  return { kind: 'multi', categories, series };
}

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

// Core aggregation without auth — called by both the session-auth Server Action
// and the API-key-auth REST route. Validates entity/fields via catalog.
export async function aggregateForWidgetCore(
  entityName: string,
  groupByField: string,
  filter: AggregateFilter = null,
  seriesField?: string,
  conditions?: FilterCondition[],
  groupByBucket?: BucketGranularity,
): Promise<AggregateOutput> {
  const entity = findDashboardEntity(entityName);
  if (!entity) throw new Error(`Entity '${entityName}' is not dashboardable`);
  const field = findDashboardField(entityName, groupByField);
  if (!field) throw new Error(`Field '${groupByField}' is not groupable on '${entityName}'`);

  const activeConditions: FilterCondition[] =
    (conditions && conditions.length > 0)
      ? conditions
      : (filter && filter.field && filter.value)
        ? [{ field: filter.field, operator: 'equals', values: [filter.value] }]
        : [];

  if (groupByBucket) {
    if (field.kind !== 'datetime') {
      throw new Error(`group_by_bucket requires a datetime field; '${groupByField}' is '${field.kind}'`);
    }
    if (seriesField) {
      const serField = findDashboardField(entityName, seriesField);
      if (!serField) throw new Error(`Field '${seriesField}' is not groupable on '${entityName}'`);
      return aggregateBucketMultiSeries(entityName, field, serField, groupByBucket, activeConditions);
    }
    return aggregateBucketSingle(entityName, field.name, groupByBucket, activeConditions);
  }

  const where: Record<string, unknown> | undefined =
    activeConditions.length > 0 ? buildConditionsWhere(activeConditions) : undefined;

  if (seriesField) {
    const serField = findDashboardField(entityName, seriesField);
    if (!serField) throw new Error(`Field '${seriesField}' is not groupable on '${entityName}'`);
    return aggregateMultiSeries(entityName, field, serField, where);
  }

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
