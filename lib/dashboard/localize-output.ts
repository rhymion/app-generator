import type { AggregateOutput } from './aggregate-core';
import type { DashboardField } from './catalog';

// Placeholder and boolean labels the aggregation emits as fixed English tokens.
export const UNSPECIFIED = '(unspecified)';
export const UNKNOWN = '(unknown)';
export const UNNAMED = '(unnamed)';

export interface LabelTranslators {
  yes: string;
  no: string;
  unspecified: string;
  unknown: string;
  unnamed: string;
  /** Translated option label of an enum field, or undefined when no translation exists. */
  enumLabel: (namespace: string, key: string) => string | undefined;
}

// Message key of an enum option: Prisma members are PascalCase, so only the first character is lowered.
export function enumOptionKey(raw: string): string {
  return raw.length > 0 ? raw[0].toLowerCase() + raw.slice(1) : raw;
}

/** Translates one category / series label of a field, leaving values that are real data untouched. */
export function localizeLabel(label: string, field: DashboardField | undefined, tr: LabelTranslators): string {
  if (label === UNSPECIFIED) return tr.unspecified;
  if (!field) return label;
  switch (field.kind) {
    case 'boolean':
      return label === 'Yes' ? tr.yes : label === 'No' ? tr.no : label;
    case 'fk':
      return label === UNKNOWN ? tr.unknown : label === UNNAMED ? tr.unnamed : label;
    case 'enum':
      return field.enum_namespace ? tr.enumLabel(field.enum_namespace, enumOptionKey(label)) ?? label : label;
    default:
      return label;
  }
}

/**
 * Translates the labels of an aggregate result. `groupField` labels the categories (single data points or the
 * categories of a multi-series result); `seriesField` labels the series of a multi-series result. A time-bucketed
 * group-by has date categories, which are not translated.
 */
export function localizeOutput(
  output: AggregateOutput,
  groupField: DashboardField | undefined,
  seriesField: DashboardField | undefined,
  tr: LabelTranslators,
): AggregateOutput {
  if (output.kind === 'single') {
    return { ...output, data: output.data.map((d) => ({ ...d, label: localizeLabel(d.label, groupField, tr) })) };
  }
  return {
    ...output,
    categories: output.categories.map((c) => localizeLabel(c, groupField, tr)),
    series: output.series.map((s) => ({ ...s, label: localizeLabel(s.label, seriesField, tr) })),
  };
}
