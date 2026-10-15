// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
// Custom save-time validation for app_setting.
//
// validateCustomRules() is called unconditionally from validateOnAdd()/
// validateOnUpdate() (see lib/app_setting/service_validation.ts), after the
// generated schema-driven checks. Throw to reject the save.
//
// The pinned business date: `business_date` is required (a real YYYY-MM-DD date) while `is_pinned` is true and
// is not checked (and never read) while it is false. An update that omits one of the two fields is judged against the stored row.
import { validateBusinessDateFields } from '@/lib/business-date-core';

export async function validateCustomRules(
  _tx: unknown,
  data: Record<string, unknown>,
  _currentId: string | null,
  prevRow?: Record<string, unknown> | null,
): Promise<void> {
  const pick = (key: 'is_pinned' | 'business_date') => (key in data ? data[key] : prevRow?.[key]);
  validateBusinessDateFields(pick('is_pinned') === true, pick('business_date'));
}
