// Hand-written validation for the parent_only fixture entity. Copied by
// scripts/compose_child_datagrid_e2e_fixture.py to lib/parent_only/service_validation_custom.ts
// in the disposable app copy, before generate-code, so the write-once stub is not written.
//
// Three rejections, one per behavior the spec checks:
//   reject-with-key     -> AppError carrying a message key that exists (ValidationMessages)
//   reject-unknown-key  -> AppError carrying a key that is NOT in the messages (falls back)
//   reject-no-key       -> AppError with no key (the existing generic text)
import { AppError } from '@/lib/_errors';

export async function validateCustomRules(
  _tx: unknown,
  data: Record<string, unknown>,
  _currentId: string | null,
  _prevRow: Record<string, unknown> | null,
  _actorId: string,
): Promise<void> {
  if (data.name === 'reject-with-key') {
    throw new AppError('VALIDATION', 'internal: reserved fixture name', 'name', undefined, 'ValidationMessages.fixtureNameReserved', { max: 3 });
  }
  if (data.name === 'reject-unknown-key') {
    throw new AppError('VALIDATION', 'internal: unknown key', 'name', undefined, 'ValidationMessages.noSuchKey');
  }
  if (data.name === 'reject-no-key') {
    throw new AppError('VALIDATION', 'internal: no key', 'name');
  }
}
