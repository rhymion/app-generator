import { describe, it, expect } from 'vitest';
import { localizeLabel, localizeOutput, enumOptionKey, type LabelTranslators } from './localize-output';
import type { DashboardField } from './catalog';

const ja = { TaskStatus: { inProgress: '進行中', done: '完了' } } as Record<string, Record<string, string>>;
const tr: LabelTranslators = {
  yes: 'はい', no: 'いいえ', unspecified: '（未指定）', unknown: '（不明）', unnamed: '（名称なし）',
  enumLabel: (ns, key) => ja[ns]?.[key],
};
const boolField: DashboardField = { name: 'done', label: 'Done', kind: 'boolean' };
const enumField: DashboardField = { name: 'status', label: 'Status', kind: 'enum', enum_values: ['InProgress', 'Done'], enum_namespace: 'TaskStatus' };
const plainEnum: DashboardField = { name: 'p', label: 'P', kind: 'enum', enum_values: ['a'] };
const fkField: DashboardField = { name: 'owner_id', label: 'Owner', kind: 'fk', fk_target: 'user', fk_label_field: 'name' };

describe('localizeLabel', () => {
  it('lowers only the first character for the option key', () => {
    expect(enumOptionKey('InProgress')).toBe('inProgress');
  });
  it('translates boolean categories', () => {
    expect(localizeLabel('Yes', boolField, tr)).toBe('はい');
    expect(localizeLabel('No', boolField, tr)).toBe('いいえ');
  });
  it('translates native enum categories through the enum namespace', () => {
    expect(localizeLabel('InProgress', enumField, tr)).toBe('進行中');
  });
  it('keeps an enum value that has no translation or no namespace', () => {
    expect(localizeLabel('Unlisted', enumField, tr)).toBe('Unlisted');
    expect(localizeLabel('a', plainEnum, tr)).toBe('a');
  });
  it('translates the placeholder categories', () => {
    expect(localizeLabel('(unspecified)', enumField, tr)).toBe('（未指定）');
    expect(localizeLabel('(unknown)', fkField, tr)).toBe('（不明）');
    expect(localizeLabel('(unnamed)', fkField, tr)).toBe('（名称なし）');
  });
  it('leaves record names and non-fk "(unknown)" untouched', () => {
    expect(localizeLabel('Yes', fkField, tr)).toBe('Yes');
    expect(localizeLabel('(unknown)', enumField, tr)).toBe('(unknown)');
  });
});

describe('localizeOutput', () => {
  it('translates single-series categories', () => {
    const out = localizeOutput({ kind: 'single', data: [{ label: 'Yes', count: 2 }, { label: '(unspecified)', count: 1 }] }, boolField, undefined, tr);
    expect(out).toEqual({ kind: 'single', data: [{ label: 'はい', count: 2 }, { label: '（未指定）', count: 1 }] });
  });
  it('translates categories by the group field and series by the series field', () => {
    const out = localizeOutput(
      { kind: 'multi', categories: ['Done'], series: [{ label: 'Yes', data: [1] }, { label: 'No', data: [2] }], timezone: 'asia_tokyo' },
      enumField, boolField, tr,
    );
    expect(out).toEqual({ kind: 'multi', categories: ['完了'], series: [{ label: 'はい', data: [1] }, { label: 'いいえ', data: [2] }], timezone: 'asia_tokyo' });
  });
});
