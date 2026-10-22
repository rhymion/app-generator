// Which widget settings apply together. Mirrors what the dashboard renders and aggregates
// (components/_standard/DashboardWidget.tsx, lib/dashboard/aggregate-core.ts), so the editor can offer only
// combinations that work instead of leaving them to fail at render time.
// Pure and free of generated imports: the editor's unit tests run on a clean checkout.

export type FieldKind = 'boolean' | 'enum' | 'fk' | 'number' | 'datetime';

export interface RuleField {
  name: string;
  kind: FieldKind;
}

export type Row = Record<string, unknown>;

const isStackable = (chartType: unknown) => chartType === 'bar' || chartType === 'column';
const kindOf = (fields: RuleField[], name: unknown) => fields.find((f) => f.name === name)?.kind;

/** Group-by choices: a line chart plots a time series, so it needs a datetime field. */
export function groupByChoices<T extends RuleField>(fields: T[], chartType: unknown): T[] {
  return chartType === 'line' ? fields.filter((f) => f.kind === 'datetime') : fields;
}

/** Series choices: every field except the one that is already the group-by. */
export function seriesChoices<T extends RuleField>(fields: T[], row: Row): T[] {
  return fields.filter((f) => f.name !== row.group_by_field);
}

/** The time bucket applies to a datetime group-by field only. */
export function showsBucket(fields: RuleField[], row: Row): boolean {
  return kindOf(fields, row.group_by_field) === 'datetime';
}

/** Pie charts ignore the series; every other chart type can split by it. */
export function showsSeries(row: Row): boolean {
  return row.chart_type !== 'pie';
}

/** Stack mode is offered for bar / column once a series exists (it needs one). */
export function showsStackMode(row: Row): boolean {
  return isStackable(row.chart_type);
}

export function stackModeEnabled(row: Row): boolean {
  return showsStackMode(row) && !!row.series_field;
}

/**
 * Brings a row back to a valid combination after `patch` was applied to it. Only the settings made inapplicable
 * by the change are touched; everything else the user chose stays.
 */
export function normalizeRow(fields: RuleField[], row: Row, defaultBucket: string | null): Row {
  const next: Row = { ...row };
  const groupable = groupByChoices(fields, next.chart_type);
  if (next.group_by_field && !groupable.some((f) => f.name === next.group_by_field)) next.group_by_field = '';
  if (!showsBucket(fields, next)) next.group_by_bucket = null;
  // A line chart is a time series: it needs the bucket.
  if (next.chart_type === 'line' && showsBucket(fields, next) && !next.group_by_bucket) next.group_by_bucket = defaultBucket;
  if (!showsSeries(next) || next.series_field === next.group_by_field) next.series_field = null;
  if (!showsStackMode(next) || !next.series_field) next.stack_mode = null;
  // Without a bucket or a stack mode the series is ignored; a bar / column then defaults to grouped bars.
  if (showsStackMode(next) && next.series_field && !next.stack_mode && !next.group_by_bucket) next.stack_mode = 'grouped';
  return next;
}
