// Prisma P2000 ("value too long for the column's type", PostgreSQL SQLSTATE 22001), Issue #1393.
//
// A field's server-side maxLength is a security limit and may be larger than its
// `@db.VarChar(n)` column, which the product spec sets; a value between n and maxLength passes
// service validation and is refused by the database. The generated service turns that into a
// field-level VALIDATION error through this helper instead of the generic "invalid value".
//
// The column comes from `meta.column_name` (Rust engine) or from the driver adapter's
// `LengthMismatch` cause. PostgreSQL does not always report it; then the field is undefined.
export function p2000Field(meta: unknown): string | undefined {
  const m = meta as {
    column_name?: unknown;
    driverAdapterError?: { cause?: { kind?: unknown; column?: unknown } };
  } | null | undefined;
  if (typeof m?.column_name === 'string' && m.column_name.length > 0) return m.column_name;
  const cause = m?.driverAdapterError?.cause;
  if (cause?.kind === 'LengthMismatch' && typeof cause.column === 'string' && cause.column.length > 0) {
    return cause.column;
  }
  return undefined;
}

/** The message for a P2000 error: names the field when it is known. */
export function p2000Message(field: string | undefined): string {
  return field ? `${field} is too long` : 'A value is too long for its column';
}
