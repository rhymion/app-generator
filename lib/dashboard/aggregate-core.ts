// Core aggregation logic — no auth check. Caller is responsible for authentication
// and authorization. Used by both the 'use server' aggregateForWidget wrapper
// (session auth) and the REST API route (API-key auth).
import prisma from '@/lib/prisma';
import { ApiError } from '@/lib/api-auth';
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

// Returns ISO-based bucket key for app-side grouping (no DB date_trunc).
function truncateToBucket(date: Date, bucket: BucketGranularity): string {
  switch (bucket) {
    case 'day':
      return date.toISOString().slice(0, 10);
    case 'week': {
      const d = new Date(date);
      // Shift to Monday (day 0 = Sunday → offset = (day + 6) % 7)
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    }
    case 'month':
      return date.toISOString().slice(0, 7);
    case 'quarter': {
      const d = new Date(date);
      const quarterMonth = Math.floor(d.getUTCMonth() / 3) * 3;
      return `${d.getUTCFullYear()}-${String(quarterMonth + 1).padStart(2, '0')}`;
    }
    case 'year':
      return date.toISOString().slice(0, 4);
  }
}

// Human-readable bucket label from the ISO key produced by truncateToBucket.
function formatBucketKey(key: string, bucket: BucketGranularity): string {
  if (bucket === 'quarter') {
    // key is "YYYY-MM" where MM is the first month of the quarter
    const [year, mm] = key.split('-');
    const q = Math.floor((Number(mm) - 1) / 3) + 1;
    return `${year} Q${q}`;
  }
  return key;
}

// Fetch all rows and group by timestamp bucket in TypeScript (no raw SQL).
async function aggregateBucketSingle(
  entityName: string,
  field: DashboardField,
  bucket: BucketGranularity,
  conditions: FilterCondition[],
): Promise<{ kind: 'single'; data: AggregateBucket[] }> {
  const where = buildConditionsWhere(conditions);
  const rows = await getModelClient(entityName).findMany({
    select: { [field.name]: true },
    where,
  }) as Array<Record<string, unknown>>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const val = row[field.name];
    const key = val instanceof Date ? truncateToBucket(val, bucket)
      : (typeof val === 'string' && val) ? truncateToBucket(new Date(val), bucket)
      : '(unspecified)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return {
    kind: 'single',
    data: sorted.map(([key, count]) => ({
      label: key === '(unspecified)' ? key : formatBucketKey(key, bucket),
      count,
    })),
  };
}

// Fetch all rows and group by (timestamp bucket × series value) in TypeScript.
async function aggregateBucketMultiSeries(
  entityName: string,
  catField: DashboardField,
  serField: DashboardField,
  bucket: BucketGranularity,
  conditions: FilterCondition[],
): Promise<{ kind: 'multi'; categories: string[]; series: { label: string; data: number[] }[] }> {
  const where = buildConditionsWhere(conditions);
  const rows = await getModelClient(entityName).findMany({
    select: { [catField.name]: true, [serField.name]: true },
    where,
  }) as Array<Record<string, unknown>>;

  // Accumulate (bucketKey, seriesKey) → count
  const counts = new Map<string, Map<string, number>>();
  const bucketOrder: string[] = [];
  const rawSerVals: unknown[] = [];

  for (const row of rows) {
    const tsVal = row[catField.name];
    const bucketKey = tsVal instanceof Date ? truncateToBucket(tsVal, bucket)
      : (typeof tsVal === 'string' && tsVal) ? truncateToBucket(new Date(tsVal), bucket)
      : '(unspecified)';
    const serVal = row[serField.name];
    const serKey = String(serVal ?? '');

    if (!counts.has(bucketKey)) {
      counts.set(bucketKey, new Map());
      bucketOrder.push(bucketKey);
    }
    const inner = counts.get(bucketKey)!;
    inner.set(serKey, (inner.get(serKey) ?? 0) + 1);

    if (!rawSerVals.includes(serVal)) rawSerVals.push(serVal);
  }

  bucketOrder.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const categories = bucketOrder.map((k) => k === '(unspecified)' ? k : formatBucketKey(k, bucket));
  const serLabels = await buildLabelMap(serField, rawSerVals);

  const series = rawSerVals.map((sv) => ({
    label: applyLabel(serLabels, sv),
    data: bucketOrder.map((bk) => counts.get(bk)?.get(String(sv ?? '')) ?? 0),
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
  if (!entity) throw new ApiError(400, `Entity '${entityName}' is not dashboardable`);
  const field = findDashboardField(entityName, groupByField);
  if (!field) throw new ApiError(400, `Unknown group_by_field: ${groupByField}`);

  // Validate all condition fields against the catalog (multi-layer defense).
  const activeConditions: FilterCondition[] =
    (conditions && conditions.length > 0)
      ? conditions
      : (filter && filter.field && filter.value)
        ? [{ field: filter.field, operator: 'equals', values: [filter.value] }]
        : [];

  for (const c of activeConditions) {
    if (!findDashboardField(entityName, c.field)) {
      throw new ApiError(400, `Unknown filter field: ${c.field}`);
    }
  }

  if (groupByBucket) {
    if (field.kind !== 'datetime') {
      throw new ApiError(400, `group_by_bucket requires a datetime field; '${groupByField}' is '${field.kind}'`);
    }
    if (seriesField) {
      const serField = findDashboardField(entityName, seriesField);
      if (!serField) throw new ApiError(400, `Unknown series_field: ${seriesField}`);
      return aggregateBucketMultiSeries(entityName, field, serField, groupByBucket, activeConditions);
    }
    return aggregateBucketSingle(entityName, field, groupByBucket, activeConditions);
  }

  const where: Record<string, unknown> | undefined =
    activeConditions.length > 0 ? buildConditionsWhere(activeConditions) : undefined;

  if (seriesField) {
    const serField = findDashboardField(entityName, seriesField);
    if (!serField) throw new ApiError(400, `Unknown series_field: ${seriesField}`);
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
