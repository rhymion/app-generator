'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { GridRowsProp } from '@/components/ui/data';
import AppAlert from '@/components/ui/AppAlert';
import AppBox from '@/components/ui/AppBox';
import AppButton from '@/components/ui/AppButton';
import AppSurface from '@/components/ui/AppSurface';
import AppText from '@/components/ui/AppText';
import AppFieldInput from '@/components/ui/forms/AppFieldInput';
import AppFieldSelect from '@/components/ui/forms/AppFieldSelect';
import type { AppFieldSelectOption } from '@/components/ui/forms/AppFieldSelect';
import { DASHBOARDABLE_ENTITIES, findDashboardEntity } from './catalog-source';
import { getReadableDashboardEntityNames } from '@/lib/dashboard/readable-entities';
import {
  groupByChoices, normalizeRow, seriesChoices, showsBucket, showsSeries, stackModeEnabled,
} from './widget-rules';

type Row = Record<string, unknown>;

interface WidgetsProps {
  initialFields?: GridRowsProp;
  createNewRow: () => Row;
  /** Column definitions of the generated grid; the select options of the enum cells come from them. */
  columns?: Array<{ field: string }>;
  title?: string;
}

export interface WidgetsHandle {
  getFields: () => GridRowsProp;
}

/**
 * Widget editor of the dashboard form (`x-custom-component` on `dashboard.widgets`). Replaces the generated
 * child grid and keeps its contract: `getFields()` returns the rows the form submits.
 */
const Widgets = forwardRef<WidgetsHandle, WidgetsProps>(function Widgets({ initialFields, createNewRow, columns = [], title }, ref) {
  const t = useTranslations('DashboardWidgetEditor');
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tk = useTranslations('DashboardWidgetEditor.fieldKind');
  const [rows, setRows] = useState<Row[]>(() => (initialFields ?? []).map((r): Row => ({ ...r })));
  // null while loading; afterwards the catalog entities the user may read.
  const [readable, setReadable] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReadableDashboardEntityNames()
      .then((names) => { if (!cancelled) setReadable(names); })
      .catch(() => { if (!cancelled) setReadable([]); });
    return () => { cancelled = true; };
  }, []);

  useImperativeHandle(ref, () => ({
    getFields: () => rows.map((r, index) => ({ ...r, order: index })),
  }), [rows]);

  const entityLabel = useCallback((name: string) => {
    const camel = name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    if (te.has(camel)) return te(camel);
    return findDashboardEntity(name)?.label ?? name;
  }, [te]);

  const entityOptions = useMemo<AppFieldSelectOption<string>[]>(
    () => DASHBOARDABLE_ENTITIES
      .filter((e) => readable?.includes(e.name))
      .map((e) => ({ value: e.name, label: entityLabel(e.name) })),
    [readable, entityLabel],
  );

  const optionsOf = (field: string): AppFieldSelectOption<string>[] => {
    const col = columns.find((c) => c.field === field) as { valueOptions?: Array<{ value: string; label: string }> } | undefined;
    return (col?.valueOptions ?? []).filter((o) => o.value !== '');
  };

  const fieldLabel = useCallback((name: string, fallback: string) => {
    const camel = name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    return tf.has(camel) ? tf(camel) : fallback;
  }, [tf]);

  const fieldOptionsOf = (fields: Array<{ name: string; label: string; kind: string }>): AppFieldSelectOption<string>[] =>
    fields.map((f) => ({ value: f.name, label: `${fieldLabel(f.name, f.label)} (${tk(f.kind)})` }));

  const bucketDefault = optionsOf('group_by_bucket')[0]?.value ?? null;

  /** Applies `patch` and brings the row back to a valid combination (see widget-rules.ts). */
  const update = (id: string, patch: Row) => setRows((prev) => prev.map((r) => {
    if (r.id !== id) return r;
    const merged = { ...r, ...patch };
    const entity = findDashboardEntity(String(merged.entity_name ?? ''));
    if (!entity) return merged;
    if (patch.entity_name !== undefined && patch.entity_name !== r.entity_name) {
      // The fields of the previous data source mean nothing for the new one.
      merged.group_by_field = '';
      merged.series_field = null;
      merged.group_by_bucket = null;
      merged.stack_mode = null;
      if (!entity.groupable_fields.some((f) => f.name === merged.filter_field)) {
        merged.filter_field = null;
        merged.filter_value = null;
      }
    }
    return normalizeRow(entity.groupable_fields, merged, bucketDefault);
  }));
  const remove = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));
  const move = (index: number, delta: number) => setRows((prev) => {
    const target = index + delta;
    if (target < 0 || target >= prev.length) return prev;
    const next = prev.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const add = () => setRows((prev) => [...prev, createNewRow()]);

  const selectValue = (options: AppFieldSelectOption<string>[], value: unknown) =>
    options.find((o) => o.value === value) ?? null;

  // A stored field that the data source no longer offers stays visible (disabled) so the widget keeps showing what it uses.
  const withCurrentField = (options: AppFieldSelectOption<string>[], value: unknown) => {
    const v = typeof value === 'string' ? value : '';
    return v && !options.some((o) => o.value === v) ? [...options, { value: v, label: v, disabled: true }] : options;
  };

  const noCatalog = DASHBOARDABLE_ENTITIES.length === 0;

  return (
    <AppBox mt={2} mb={2}>
      {title && <AppText variant="h6" mb={1}>{title}</AppText>}
      {noCatalog && (
        <AppAlert severity="info" mb={2}>
          {t('noDashboardEntities')}{' '}
          <a href={t('docsUrl')} target="_blank" rel="noopener noreferrer">{t('docsLinkLabel')}</a>
        </AppAlert>
      )}
      {rows.map((row, index) => {
        const id = String(row.id);
        const known = findDashboardEntity(String(row.entity_name ?? ''));
        const current = String(row.entity_name ?? '');
        const stillLoading = readable === null;
        const options = entityOptions;
        // The stored value stays selectable so an existing widget keeps showing what it uses.
        const withCurrent = current && !options.some((o) => o.value === current)
          ? [...options, { value: current, label: known ? entityLabel(current) : current, disabled: true }]
          : options;
        const unknownSource = current !== '' && !known;
        const unreadableSource = !noCatalog && !stillLoading && !!known && !readable?.includes(current);
        const fields = known?.groupable_fields ?? [];
        const groupOptions = withCurrentField(fieldOptionsOf(groupByChoices(fields, row.chart_type)), row.group_by_field);
        const seriesOptions = withCurrentField(fieldOptionsOf(seriesChoices(fields, row)), row.series_field);
        const groupValue = String(row.group_by_field ?? '');
        const unknownField = !!known && groupValue !== '' && !fields.some((f) => f.name === groupValue);
        return (
          <AppSurface key={id} variant="outlined" elevation={0} p={2} mb={2}>
            <div data-testid={`widget-row-${index}`}>
              <AppFieldInput
                label={tf('name')}
                value={String(row.name ?? '')}
                onChange={(v) => update(id, { name: v })}
                fullWidth
                required
              />
              <AppFieldSelect
                label={tf('entityName')}
                options={withCurrent}
                value={selectValue(withCurrent, current)}
                onChange={(v) => update(id, { entity_name: v ?? '' })}
                required
              />
              {unknownSource && <AppAlert severity="error" mb={1}>{t('unknownDataSource', { name: current })}</AppAlert>}
              {unreadableSource && <AppAlert severity="warning" mb={1}>{t('unreadableDataSource', { name: entityLabel(current) })}</AppAlert>}
              <AppFieldSelect
                label={tf('chartType')}
                options={optionsOf('chart_type')}
                value={selectValue(optionsOf('chart_type'), row.chart_type)}
                onChange={(v) => update(id, { chart_type: v ?? 'column' })}
                required
              />
              <AppFieldSelect
                label={tf('groupByField')}
                options={groupOptions}
                value={selectValue(groupOptions, row.group_by_field)}
                onChange={(v) => update(id, { group_by_field: v ?? '' })}
                required
              />
              {row.chart_type === 'line' && <AppText variant="caption" mb={1}>{t('lineNeedsDatetime')}</AppText>}
              {unknownField && <AppAlert severity="error" mb={1}>{t('unknownField', { name: String(row.group_by_field) })}</AppAlert>}
              {known && showsBucket(fields, row) && (
                <AppFieldSelect
                  label={tf('groupByBucket')}
                  options={optionsOf('group_by_bucket')}
                  value={selectValue(optionsOf('group_by_bucket'), row.group_by_bucket)}
                  onChange={(v) => update(id, { group_by_bucket: v })}
                  required={row.chart_type === 'line'}
                />
              )}
              <AppFieldSelect
                label={tf('timezone')}
                options={optionsOf('timezone')}
                value={selectValue(optionsOf('timezone'), row.timezone)}
                onChange={(v) => update(id, { timezone: v ?? 'utc' })}
              />
              {known && showsSeries(row) && (
                <AppFieldSelect
                  label={tf('seriesField')}
                  options={seriesOptions}
                  value={selectValue(seriesOptions, row.series_field)}
                  onChange={(v) => update(id, { series_field: v || null })}
                />
              )}
              {known && stackModeEnabled(row) && (
                <AppFieldSelect
                  label={tf('stackMode')}
                  options={optionsOf('stack_mode')}
                  value={selectValue(optionsOf('stack_mode'), row.stack_mode)}
                  onChange={(v) => update(id, { stack_mode: v || null })}
                />
              )}
              <AppFieldInput
                label={tf('filterField')}
                value={String(row.filter_field ?? '')}
                onChange={(v) => update(id, { filter_field: v === '' ? null : v })}
                fullWidth
              />
              <AppFieldInput
                label={tf('filterValue')}
                value={String(row.filter_value ?? '')}
                onChange={(v) => update(id, { filter_value: v === '' ? null : v })}
                fullWidth
              />
              <AppBox display="flex" gap={1} mt={1}>
                <AppButton variant="outlined" size="small" disabled={index === 0} onClick={() => move(index, -1)}>{t('moveUp')}</AppButton>
                <AppButton variant="outlined" size="small" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>{t('moveDown')}</AppButton>
                <AppButton variant="outlined" size="small" color="error" onClick={() => remove(id)}>{t('removeWidget')}</AppButton>
              </AppBox>
            </div>
          </AppSurface>
        );
      })}
      <AppButton variant="outlined" onClick={add}>{t('addWidget')}</AppButton>
    </AppBox>
  );
});

export default Widgets;
