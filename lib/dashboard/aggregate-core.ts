// Core aggregation logic — no auth check. Caller is responsible for authentication
// and authorization. Used by both the 'use server' aggregateForWidget wrapper
// (session auth) and the REST API route (API-key auth).
import prisma from '@/lib/prisma';
import { ApiError } from '@/lib/api-auth';
import { findDashboardEntity, findDashboardField, DashboardField } from './catalog';
import { TIMEZONE_VALUES, TIMEZONE_IANA_NAME, DEFAULT_TIMEZONE, type Timezone } from '@/lib/_timezone';

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

// `timezone` is set only when time buckets were computed in a zone other than UTC, so the caller
// can label the chart with the zone's translated name.
export type AggregateOutput =
  | { kind: 'single'; data: AggregateBucket[]; timezone?: Timezone }
  | { kind: 'multi'; categories: string[]; series: { label: string; data: number[] }[]; timezone?: Timezone };

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

const pad2 = (n: number) => String(n).padStart(2, '0');

const zoneFormatters = new Map<Timezone, Intl.DateTimeFormat>();

// Calendar year/month/day of an instant in the zone. The zone is resolved only through
// TIMEZONE_IANA_NAME, so no IANA spelling lives anywhere else.
function civilDateInZone(date: Date, zone: Timezone): { y: number; m: number; d: number } {
  let fmt = zoneFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE_IANA_NAME[zone],
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    zoneFormatters.set(zone, fmt);
  }
  const parts = fmt.formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: pick('year'), m: pick('month'), d: pick('day') };
}

// Returns ISO-based bucket key for app-side grouping (no DB date_trunc). Boundaries are the zone's
// calendar day / Monday-start week / month / quarter / year, so they follow DST changes.
export function truncateToBucket(date: Date, bucket: BucketGranularity, zone: Timezone = DEFAULT_TIMEZONE): string {
  const { y, m, d } = civilDateInZone(date, zone);
  switch (bucket) {
    case 'day':
      return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
    case 'week': {
      // Civil-date arithmetic on a UTC date, so DST never enters the calculation.
      const monday = new Date(Date.UTC(y, m - 1, d));
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      return monday.toISOString().slice(0, 10);
    }
    case 'month':
      return `${String(y).padStart(4, '0')}-${pad2(m)}`;
    case 'quarter':
      return `${String(y).padStart(4, '0')}-${pad2(Math.floor((m - 1) / 3) * 3 + 1)}`;
    case 'year':
      return String(y).padStart(4, '0');
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
  zone: Timezone,
): Promise<{ kind: 'single'; data: AggregateBucket[]; timezone?: Timezone }> {
  const where = buildConditionsWhere(conditions);
  const rows = await getModelClient(entityName).findMany({
    select: { [field.name]: true },
    where,
  }) as Array<Record<string, unknown>>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const val = row[field.name];
    const key = val instanceof Date ? truncateToBucket(val, bucket, zone)
      : (typeof val === 'string' && val) ? truncateToBucket(new Date(val), bucket, zone)
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
    ...(zone !== DEFAULT_TIMEZONE ? { timezone: zone } : {}),
  };
}

// Fetch all rows and group by (timestamp bucket × series value) in TypeScript.
async function aggregateBucketMultiSeries(
  entityName: string,
  catField: DashboardField,
  serField: DashboardField,
  bucket: BucketGranularity,
  conditions: FilterCondition[],
  zone: Timezone,
): Promise<{ kind: 'multi'; categories: string[]; series: { label: string; data: number[] }[]; timezone?: Timezone }> {
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
    const bucketKey = tsVal instanceof Date ? truncateToBucket(tsVal, bucket, zone)
      : (typeof tsVal === 'string' && tsVal) ? truncateToBucket(new Date(tsVal), bucket, zone)
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

  return { kind: 'multi', categories, series, ...(zone !== DEFAULT_TIMEZONE ? { timezone: zone } : {}) };
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

// A missing time zone means UTC; an unknown value is a client error, never silently coerced.
function resolveTimezone(raw: string | null | undefined): Timezone {
  if (raw == null || raw === '') return DEFAULT_TIMEZONE;
  if (!(TIMEZONE_VALUES as readonly string[]).includes(raw)) {
    throw new ApiError(400, `Unknown timezone: ${raw}`);
  }
  return raw as Timezone;
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
  timezone?: string | null,
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

  const zone = resolveTimezone(timezone);
  // Date-only fields keep the calendar date as stored (UTC); a time zone only applies to date-times.
  const zoneApplies = field.kind === 'datetime' && field.datetime_format === 'date-time';
  if (zone !== DEFAULT_TIMEZONE && !zoneApplies) {
    throw new ApiError(400, `timezone '${zone}' requires a date-time group_by_field; '${groupByField}' is not a date-time field`);
  }

  if (groupByBucket) {
    if (field.kind !== 'datetime') {
      throw new ApiError(400, `group_by_bucket requires a datetime field; '${groupByField}' is '${field.kind}'`);
    }
    if (seriesField) {
      const serField = findDashboardField(entityName, seriesField);
      if (!serField) throw new ApiError(400, `Unknown series_field: ${seriesField}`);
      return aggregateBucketMultiSeries(entityName, field, serField, groupByBucket, activeConditions, zone);
    }
    return aggregateBucketSingle(entityName, field, groupByBucket, activeConditions, zone);
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
