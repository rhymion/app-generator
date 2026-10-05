// Hand-written dependency values for the hook_slot fixture entity. Copied by
// scripts/compose_child_datagrid_e2e_fixture.py to cypress/support/hook_slot/helper_custom.ts
// in the disposable app copy, before generate-code, so the write-once stub is not written.
//
// hook_slot has two foreign keys to hook_unit. The `unit` dependency must be 'composite'
// (the column's own default stays 'atomic'); `second_unit` is left alone.
import type { DependencyKey } from './helper';

export function dependencyValues(
  key: DependencyKey,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  if (key === 'hook_unit.unit') return { ...defaults, kind: 'composite' };
  return defaults;
}
