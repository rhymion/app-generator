import { describe, it, expect } from 'vitest';
import { groupByChoices, normalizeRow, seriesChoices, showsBucket, showsSeries, stackModeEnabled, type RuleField } from './widget-rules';

const fields: RuleField[] = [
  { name: 'status', kind: 'enum' },
  { name: 'owner_id', kind: 'fk' },
  { name: 'created_at', kind: 'datetime' },
];
const row = { entity_name: 'task', group_by_field: 'status', chart_type: 'column', stack_mode: null, group_by_bucket: null, series_field: null };

describe('widget rules', () => {
  it('offers only datetime fields to group a line chart by', () => {
    expect(groupByChoices(fields, 'line').map((f) => f.name)).toEqual(['created_at']);
    expect(groupByChoices(fields, 'column')).toHaveLength(3);
  });

  it('leaves the group-by field out of the series choices', () => {
    expect(seriesChoices(fields, row).map((f) => f.name)).toEqual(['owner_id', 'created_at']);
  });

  it('offers the bucket only for a datetime group-by and the series not for pie', () => {
    expect(showsBucket(fields, row)).toBe(false);
    expect(showsBucket(fields, { ...row, group_by_field: 'created_at' })).toBe(true);
    expect(showsSeries({ ...row, chart_type: 'pie' })).toBe(false);
    expect(showsSeries(row)).toBe(true);
  });

  it('offers a stack mode only for bar / column that has a series', () => {
    expect(stackModeEnabled(row)).toBe(false);
    expect(stackModeEnabled({ ...row, series_field: 'owner_id' })).toBe(true);
    expect(stackModeEnabled({ ...row, chart_type: 'line', series_field: 'owner_id' })).toBe(false);
  });

  it('clears the bucket when the group-by field is not a datetime', () => {
    expect(normalizeRow(fields, { ...row, group_by_bucket: 'week' }, 'day').group_by_bucket).toBeNull();
  });

  it('gives a line chart on a datetime field the default bucket and drops a non-datetime group-by', () => {
    expect(normalizeRow(fields, { ...row, chart_type: 'line', group_by_field: 'created_at' }, 'day').group_by_bucket).toBe('day');
    expect(normalizeRow(fields, { ...row, chart_type: 'line' }, 'day').group_by_field).toBe('');
  });

  it('drops series and stack mode when the chart becomes a pie', () => {
    const next = normalizeRow(fields, { ...row, chart_type: 'pie', series_field: 'owner_id', stack_mode: 'stacked' }, 'day');
    expect(next).toMatchObject({ series_field: null, stack_mode: null });
  });

  it('defaults a bar / column series without bucket to grouped, and clears the stack mode with the series', () => {
    expect(normalizeRow(fields, { ...row, series_field: 'owner_id' }, 'day').stack_mode).toBe('grouped');
    expect(normalizeRow(fields, { ...row, series_field: null, stack_mode: 'stacked' }, 'day').stack_mode).toBeNull();
  });

  it('keeps the series of a bucketed bar without forcing a stack mode', () => {
    const next = normalizeRow(fields, { ...row, group_by_field: 'created_at', group_by_bucket: 'week', series_field: 'owner_id' }, 'day');
    expect(next).toMatchObject({ series_field: 'owner_id', stack_mode: null });
  });

  it('clears a series equal to the group-by field', () => {
    expect(normalizeRow(fields, { ...row, series_field: 'status' }, 'day').series_field).toBeNull();
  });
});
