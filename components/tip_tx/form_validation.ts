const REQUIRED_FIELDS = [
  { key: 'gross_amount', label: 'Gross Amount' },
  { key: 'operator_fee', label: 'Operator Fee' },
  { key: 'payment_fee', label: 'Payment Fee' },
  { key: 'contract_split_id', label: 'Contract Split' },
  { key: 'status', label: 'Status' },
  { key: 'comment_id', label: 'Comment' },
] as const;

function isMissingValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'boolean') return false;
  if (typeof value === 'number') return Number.isNaN(value);
  if (value instanceof Date) return Number.isNaN(value.getTime());
  if (typeof value === 'object' && value !== null && 'isValid' in value) {
    const maybeDayjs = value as { isValid?: () => boolean };
    if (typeof maybeDayjs.isValid === 'function') {
      return !maybeDayjs.isValid();
    }
  }
  return false;
}

export function validateForm(values: Record<string, unknown>): string | null {
  for (const field of REQUIRED_FIELDS) {
    if (isMissingValue(values[field.key])) {
      return `${field.label} is required`;
    }
  }
  return null;
}
