import { describe, it, expect } from 'vitest';
import { AppError } from '@/lib/_errors';
import { validateWidgets } from './widgets-validation';

const catalog = [
  {
    name: 'task',
    label: 'Task',
    groupable_fields: [
      { name: 'status', label: 'Status', kind: 'enum' as const, enum_values: ['open', 'closed'] },
      { name: 'created_at', label: 'Created at', kind: 'datetime' as const, datetime_format: 'date-time' as const },
    ],
  },
];

const good = { name: 'By status', entity_name: 'task', group_by_field: 'status', chart_type: 'pie' };

function rejection(widgets: unknown, stored?: Parameters<typeof validateWidgets>[2]): AppError {
  try {
    validateWidgets(catalog, widgets, stored);
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error('expected a rejection');
}

describe('validateWidgets', () => {
  it('accepts drawable widgets, and none at all', () => {
    expect(() => validateWidgets(catalog, [good])).not.toThrow();
    expect(() => validateWidgets(catalog, [])).not.toThrow();
    expect(() => validateWidgets(catalog, undefined)).not.toThrow();
  });

  it('rejects an invalid widget with a field-level error that names the widget and carries an i18n key', () => {
    const error = rejection([good, { ...good, name: 'Broken', group_by_field: 'removed' }]);
    expect(error).toMatchObject({
      code: 'VALIDATION',
      field: 'widgets',
      reason: 'invalid',
      messageKey: 'DashboardWidgetProblem.unknownField',
      messageArgs: { where: '#2 "Broken": ', entity: 'Task', field: 'removed' },
    });
  });

  it('uses the display labels of the catalog in the message arguments', () => {
    const error = rejection([{ ...good, group_by_bucket: 'month' }]);
    expect(error.messageKey).toBe('DashboardWidgetProblem.bucketNeedsDatetime');
    expect(error.messageArgs).toMatchObject({ field: 'Status', kind: 'enum' });
  });

  it('gives each failure case its own key', () => {
    const keyOf = (patch: Record<string, unknown>) => rejection([{ ...good, ...patch }]).messageKey;
    expect(keyOf({ entity_name: 'gone' })).toBe('DashboardWidgetProblem.dataSourceUnavailable');
    expect(keyOf({ series_field: 'removed' })).toBe('DashboardWidgetProblem.unknownField');
    expect(keyOf({ chart_type: 'line' })).toBe('DashboardWidgetProblem.lineNeedsBucket');
    expect(keyOf({ stack_mode: 'stacked' })).toBe('DashboardWidgetProblem.stackNeedsSeries');
    expect(keyOf({ timezone: 'asia_tokyo' })).toBe('DashboardWidgetProblem.timezoneNeedsDatetime');
    expect(keyOf({ filter_field: 'status', filter_value: 'archived' })).toBe('DashboardWidgetProblem.invalidFilterValue');
  });

  it('does not re-judge a stored widget that is saved unchanged', () => {
    const legacy = { id: 'w1', ...good, entity_name: 'removed_entity' };
    expect(() => validateWidgets(catalog, [{ ...legacy }], [legacy])).not.toThrow();
    // ... but holds it to the rules as soon as the user changes it.
    expect(rejection([{ ...legacy, name: 'x', group_by_field: 'status', chart_type: 'column' }], [legacy]).messageKey)
      .toBe('DashboardWidgetProblem.dataSourceUnavailable');
    // A new widget (no stored match) is always judged.
    expect(rejection([{ ...legacy, id: 'new' }], [legacy]).messageKey).toBe('DashboardWidgetProblem.dataSourceUnavailable');
  });

  it('rejects nothing when the schema offers no data source to judge against', () => {
    expect(() => validateWidgets([], [{ ...good, entity_name: 'anything' }])).not.toThrow();
  });
});
