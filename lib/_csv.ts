/**
 * Escapes a single CSV field per RFC 4180: wraps in double quotes and
 * doubles any embedded quote when the value contains a quote, comma, or
 * newline. Non-Date object values are JSON-stringified rather than falling
 * through to the default `[object Object]` stringification.
 */
export function escapeCSV(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date
    ? v.toISOString()
    : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
