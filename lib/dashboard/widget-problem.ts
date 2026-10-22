// Why a dashboard widget cannot be shown, as data. One set of rules serves the aggregate (view time), the dashboard
// save validation and the widget editor, so a misconfiguration reads the same everywhere. Messages are not built here:
// the UI translates `code` (namespace DashboardWidgetProblem) with `params`. Pure and free of generated imports so the
// unit tests run on a clean checkout; the catalog is passed in.

export type ProblemSetting =
  | 'entity_name'
  | 'group_by_field'
  | 'series_field'
  | 'filter_field'
  | 'filter_value'
  | 'group_by_bucket'
  | 'stack_mode'
  | 'timezone';

export type ProblemCode =
  | 'noDataSources'       // the schema opts no entity in, so nothing can be charted
  | 'dataSourceUnavailable' // the entity is not (or no longer) opted in
  | 'noPermission'        // the viewer may not read the entity
  | 'unknownField'        // the field does not exist on the data source (or was removed)
  | 'bucketNeedsDatetime' // a time bucket on a field that is not a date or time
  | 'lineNeedsBucket'     // a line chart is a time series
  | 'stackNeedsSeries'    // a stack mode with no series field
  | 'timezoneNeedsDatetime' // a time zone on a field that is not a date-time
  | 'invalidFilterValue'  // the filter value does not fit the filtered field
  | 'seriesSameAsGroup';  // the series splits by the field already grouped on

export interface WidgetProblem {
  code: ProblemCode;
  setting: ProblemSetting | null;
  /** Raw names and values; the UI turns entity / field names into labels. Strings only. */
  params: Record<string, string>;
}

export interface CatalogField {
  name: string;
  kind: 'boolean' | 'enum' | 'fk' | 'number' | 'datetime';
  enum_values?: string[];
  datetime_format?: 'date' | 'date-time';
}

export interface CatalogEntity {
  name: string;
  groupable_fields: CatalogField[];
}

export interface WidgetInput {
  entity_name?: string | null;
  group_by_field?: string | null;
  chart_type?: string | null;
  stack_mode?: string | null;
  series_field?: string | null;
  group_by_bucket?: string | null;
  timezone?: string | null;
  filter_field?: string | null;
  filter_value?: string | null;
}

const problem = (code: ProblemCode, setting: ProblemSetting | null, params: Record<string, string> = {}): WidgetProblem =>
  ({ code, setting, params });

const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/** A filter value is text; whether it fits depends on the filtered field. True when it does not fit. */
export function isInvalidFilterValue(field: CatalogField, value: string): boolean {
  switch (field.kind) {
    case 'number':
      return !NUMBER_PATTERN.test(value.trim());
    case 'boolean':
      return value !== 'true' && value !== 'false';
    case 'datetime':
      return Number.isNaN(new Date(value).getTime());
    case 'enum': {
      // A native enum stores its label; a legacy integer enum stores the index. Either spelling is accepted.
      const values = field.enum_values ?? [];
      return !values.includes(value) && !(/^\d+$/.test(value) && Number(value) < values.length);
    }
    default:
      return false;
  }
}

/** Every problem of a widget configuration, most fundamental first. Empty when the widget can be drawn. */
export function findWidgetProblems(catalog: CatalogEntity[], widget: WidgetInput): WidgetProblem[] {
  if (catalog.length === 0) return [problem('noDataSources', null)];
  const entityName = widget.entity_name ?? '';
  const entity = catalog.find((e) => e.name === entityName);
  if (!entity) return [problem('dataSourceUnavailable', 'entity_name', { entity: entityName })];

  const problems: WidgetProblem[] = [];
  const fieldOf = (name: string) => entity.groupable_fields.find((f) => f.name === name);
  const unknown = (setting: ProblemSetting, name: string) =>
    problems.push(problem('unknownField', setting, { entity: entityName, field: name }));

  const groupName = widget.group_by_field ?? '';
  const group = fieldOf(groupName);
  if (!group) unknown('group_by_field', groupName);

  const seriesName = widget.series_field ?? '';
  if (seriesName) {
    if (!fieldOf(seriesName)) unknown('series_field', seriesName);
    else if (seriesName === groupName) problems.push(problem('seriesSameAsGroup', 'series_field', { field: seriesName }));
  }

  const filterName = widget.filter_field ?? '';
  const filterValue = widget.filter_value ?? '';
  if (filterName) {
    const filtered = fieldOf(filterName);
    if (!filtered) unknown('filter_field', filterName);
    else if (filterValue !== '' && isInvalidFilterValue(filtered, filterValue)) {
      problems.push(problem('invalidFilterValue', 'filter_value', { field: filterName, kind: filtered.kind, value: filterValue }));
    }
  }

  if (group) {
    if (widget.group_by_bucket && group.kind !== 'datetime') {
      problems.push(problem('bucketNeedsDatetime', 'group_by_bucket', { field: groupName, kind: group.kind }));
    }
    if (widget.timezone && widget.timezone !== 'utc' && !(group.kind === 'datetime' && group.datetime_format === 'date-time')) {
      problems.push(problem('timezoneNeedsDatetime', 'timezone', { field: groupName, kind: group.kind }));
    }
  }
  return [...problems, ...findChartProblems(widget)];
}

/** The rules that need no catalog: how the chart type, time bucket, stack mode and series fit together. */
export function findChartProblems(widget: WidgetInput): WidgetProblem[] {
  const problems: WidgetProblem[] = [];
  if (widget.chart_type === 'line' && !widget.group_by_bucket) {
    problems.push(problem('lineNeedsBucket', 'group_by_bucket'));
  }
  if (widget.stack_mode && !widget.series_field) {
    problems.push(problem('stackNeedsSeries', 'stack_mode', { mode: widget.stack_mode }));
  }
  return problems;
}

/** English text for callers that have no translations (the REST response, the thrown fallback). */
export function describeProblem(p: WidgetProblem): string {
  const { entity = '', field = '', kind = '', value = '', mode = '' } = p.params;
  switch (p.code) {
    case 'noDataSources': return 'No entity is enabled for dashboards (x-display.dashboard: true), so there is no data source to chart.';
    case 'dataSourceUnavailable': return `Data source '${entity}' is not available for dashboards. Choose another data source.`;
    case 'noPermission': return `No permission to read the data source '${entity}'.`;
    case 'unknownField': return `Field '${field}' does not exist on data source '${entity}' (it may have been removed). Choose another field.`;
    case 'bucketNeedsDatetime': return `Field '${field}' (${kind}) cannot be bucketed by time because it is not a date or time field. Choose a date or time field, or clear the time bucket.`;
    case 'lineNeedsBucket': return 'A line chart plots a time series. Choose a time bucket.';
    case 'stackNeedsSeries': return `Stack mode '${mode}' needs a series field. Choose a series field or clear the stack mode.`;
    case 'timezoneNeedsDatetime': return `A time zone applies only to date-time fields; '${field}' is not one. Use UTC or choose a date-time field.`;
    case 'invalidFilterValue': return `Filter value '${value}' does not fit the field '${field}' (${kind}). Enter a matching value or clear the filter.`;
    case 'seriesSameAsGroup': return `Series field '${field}' is the same as the group-by field. Choose a different series field.`;
  }
}

/** Carries a problem through code that can only throw (the aggregate core, called by the REST route too). */
export class WidgetProblemError extends Error {
  readonly name = 'WidgetProblemError';
  constructor(public readonly problem: WidgetProblem) {
    super(describeProblem(problem));
  }
}
