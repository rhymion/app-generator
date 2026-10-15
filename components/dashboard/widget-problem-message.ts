'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { findDashboardEntity } from './catalog-source';
import type { WidgetProblem } from '@/lib/dashboard/widget-problem';

const camelCase = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Translated display labels of an entity and of one of its fields; falls back to the catalog label, then the name. */
export function useDashboardNameLabels() {
  const te = useTranslations('EntityLabel');
  const tf = useTranslations('Fields');
  const entityLabel = useCallback((name: string) => {
    const key = camelCase(name);
    return te.has?.(key) ? te(key) : findDashboardEntity(name)?.label ?? name;
  }, [te]);
  const fieldLabel = useCallback((name: string, entity?: string) => {
    const key = camelCase(name);
    if (tf.has?.(key)) return tf(key);
    return (entity ? findDashboardEntity(entity)?.groupable_fields.find((f) => f.name === name)?.label : undefined) ?? name;
  }, [tf]);
  return { entityLabel, fieldLabel };
}

/**
 * Turns a widget problem into the translated sentence the user reads: it names the setting, says why it is wrong and
 * how to fix it. Entity and field names become their display labels. `where` prefixes the sentence when the widget
 * is not obvious from the place it is shown (the save-time message names it; the widget's own card does not).
 */
export function useProblemMessage() {
  const t = useTranslations('DashboardWidgetProblem');
  const te = useTranslations('EntityLabel');
  const tf = useTranslations('Fields');
  const tk = useTranslations('DashboardWidgetEditor.fieldKind');

  return useCallback((problem: WidgetProblem, where = ''): string => {
    const { entity, field, kind, value, mode } = problem.params;
    const entityLabel = (name: string) => {
      const key = camelCase(name);
      return te.has?.(key) ? te(key) : findDashboardEntity(name)?.label ?? name;
    };
    const fieldLabel = (name: string) => {
      const key = camelCase(name);
      if (tf.has?.(key)) return tf(key);
      return (entity ? findDashboardEntity(entity)?.groupable_fields.find((f) => f.name === name)?.label : undefined) ?? name;
    };
    return t(problem.code, {
      where,
      entity: entity ? entityLabel(entity) : '',
      field: field ? fieldLabel(field) : '',
      kind: kind ? tk(kind) : '',
      value: value ?? '',
      mode: mode ?? '',
    });
  }, [t, te, tf, tk]);
}
