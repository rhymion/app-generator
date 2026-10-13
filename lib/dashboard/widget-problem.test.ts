import { describe, it, expect } from 'vitest';
import {
  describeProblem,
  findChartProblems,
  findWidgetProblems,
  isInvalidFilterValue,
  type CatalogEntity,
  type WidgetInput,
} from './widget-problem';

const catalog: CatalogEntity[] = [
  {
    name: 'task',
    groupable_fields: [
      { name: 'status', kind: 'enum', enum_values: ['open', 'closed'] },
      { name: 'done', kind: 'boolean' },
      { name: 'points', kind: 'number' },
      { name: 'owner_id', kind: 'fk' },
      { name: 'due_date', kind: 'datetime', datetime_format: 'date' },
      { name: 'created_at', kind: 'datetime', datetime_format: 'date-time' },
    ],
  },
];

const ok: WidgetInput = { entity_name: 'task', group_by_field: 'status', chart_type: 'pie' };
const codes = (w: WidgetInput) => findWidgetProblems(catalog, w).map((p) => p.code);

describe('findWidgetProblems', () => {
  it('accepts a consistent widget', () => {
    expect(codes(ok)).toEqual([]);
    expect(codes({ ...ok, chart_type: 'line', group_by_field: 'created_at', group_by_bucket: 'month', timezone: 'asia_tokyo' })).toEqual([]);
  });

  it('says there is no data source when the schema opts no entity in', () => {
    expect(findWidgetProblems([], ok)).toEqual([{ code: 'noDataSources', setting: null, params: {} }]);
  });

  it('names a data source that is not (or no longer) available', () => {
    expect(findWidgetProblems(catalog, { ...ok, entity_name: 'gone' })).toEqual([
      { code: 'dataSourceUnavailable', setting: 'entity_name', params: { entity: 'gone' } },
    ]);
    expect(codes({ ...ok, entity_name: '' })).toEqual(['dataSourceUnavailable']);
  });

  it('names an unknown or removed field, for each setting that takes a field', () => {
    expect(findWidgetProblems(catalog, { ...ok, group_by_field: 'removed' })).toEqual([
      { code: 'unknownField', setting: 'group_by_field', params: { entity: 'task', field: 'removed' } },
    ]);
    expect(findWidgetProblems(catalog, { ...ok, group_by_field: '' })[0].setting).toBe('group_by_field');
    expect(findWidgetProblems(catalog, { ...ok, series_field: 'removed' })[0]).toMatchObject({ code: 'unknownField', setting: 'series_field' });
    expect(findWidgetProblems(catalog, { ...ok, filter_field: 'removed', filter_value: 'x' })[0]).toMatchObject({ code: 'unknownField', setting: 'filter_field' });
  });

  it('rejects a time bucket on a field that is not a date or time', () => {
    expect(findWidgetProblems(catalog, { ...ok, group_by_bucket: 'month' })).toEqual([
      { code: 'bucketNeedsDatetime', setting: 'group_by_bucket', params: { field: 'status', kind: 'enum' } },
    ]);
  });

  it('rejects a time zone unless the group-by field is a date-time', () => {
    expect(codes({ ...ok, timezone: 'asia_tokyo' })).toEqual(['timezoneNeedsDatetime']);
    expect(codes({ ...ok, group_by_field: 'due_date', timezone: 'asia_tokyo' })).toEqual(['timezoneNeedsDatetime']);
    expect(codes({ ...ok, timezone: 'utc' })).toEqual([]);
  });

  it('rejects a series that repeats the group-by field', () => {
    expect(codes({ ...ok, series_field: 'status' })).toEqual(['seriesSameAsGroup']);
  });

  it('rejects a filter value that does not fit the filtered field', () => {
    expect(findWidgetProblems(catalog, { ...ok, filter_field: 'points', filter_value: 'many' })).toEqual([
      { code: 'invalidFilterValue', setting: 'filter_value', params: { field: 'points', kind: 'number', value: 'many' } },
    ]);
    expect(codes({ ...ok, filter_field: 'points', filter_value: '12' })).toEqual([]);
    expect(codes({ ...ok, filter_field: 'points' })).toEqual([]);
  });

  it('reports every problem of a widget, not only the first', () => {
    expect(codes({ ...ok, chart_type: 'line', group_by_bucket: 'month', stack_mode: 'stacked' })).toEqual([
      'bucketNeedsDatetime', 'stackNeedsSeries',
    ]);
  });
});

describe('findChartProblems', () => {
  it('needs a time bucket for a line chart', () => {
    expect(findChartProblems({ chart_type: 'line' }).map((p) => p.code)).toEqual(['lineNeedsBucket']);
    expect(findChartProblems({ chart_type: 'line', group_by_bucket: 'day' })).toEqual([]);
  });

  it('needs a series field for a stack mode', () => {
    expect(findChartProblems({ chart_type: 'column', stack_mode: 'stacked' })[0]).toMatchObject({ code: 'stackNeedsSeries', params: { mode: 'stacked' } });
    expect(findChartProblems({ chart_type: 'column', stack_mode: 'stacked', series_field: 'status' })).toEqual([]);
  });
});

describe('isInvalidFilterValue', () => {
  const field = (kind: string, extra = {}) => ({ name: 'f', kind, ...extra }) as Parameters<typeof isInvalidFilterValue>[0];
  it('checks the value against the field kind', () => {
    expect(isInvalidFilterValue(field('number'), '-1.5')).toBe(false);
    expect(isInvalidFilterValue(field('number'), '1e3')).toBe(true);
    expect(isInvalidFilterValue(field('boolean'), 'true')).toBe(false);
    expect(isInvalidFilterValue(field('boolean'), 'yes')).toBe(true);
    expect(isInvalidFilterValue(field('datetime'), '2026-01-31')).toBe(false);
    expect(isInvalidFilterValue(field('datetime'), 'tomorrow')).toBe(true);
    expect(isInvalidFilterValue(field('fk'), 'anything')).toBe(false);
  });

  it('accepts an enum label or an index of a legacy integer enum', () => {
    const status = field('enum', { enum_values: ['open', 'closed'] });
    expect(isInvalidFilterValue(status, 'closed')).toBe(false);
    expect(isInvalidFilterValue(status, '1')).toBe(false);
    expect(isInvalidFilterValue(status, '2')).toBe(true);
    expect(isInvalidFilterValue(status, 'archived')).toBe(true);
  });
});

describe('describeProblem', () => {
  it('has a distinct English sentence per code that names the setting and the fix', () => {
    const codes = ['noDataSources', 'dataSourceUnavailable', 'noPermission', 'unknownField', 'bucketNeedsDatetime',
      'lineNeedsBucket', 'stackNeedsSeries', 'timezoneNeedsDatetime', 'invalidFilterValue', 'seriesSameAsGroup'] as const;
    const texts = codes.map((code) => describeProblem({ code, setting: null, params: { entity: 'task', field: 'status', kind: 'enum', value: 'x', mode: 'stacked' } }));
    expect(new Set(texts).size).toBe(codes.length);
    expect(describeProblem({ code: 'bucketNeedsDatetime', setting: 'group_by_bucket', params: { field: 'status', kind: 'enum' } }))
      .toBe("Field 'status' (enum) cannot be bucketed by time because it is not a date or time field. Choose a date or time field, or clear the time bucket.");
  });
});
