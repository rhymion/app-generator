// Values starting with these characters are interpreted as formulas by
// Excel/Sheets when a CSV is opened (cmd_324 SA-2). A leading tab defeats
// the formula interpretation while remaining visually identical on open.
const FORMULA_TRIGGER = /^[=+\-@]/;

/**
 * Escapes a single CSV field per RFC 4180: wraps in double quotes and
 * doubles any embedded quote when the value contains a quote, comma, or
 * newline. Non-Date object values are JSON-stringified rather than falling
 * through to the default `[object Object]` stringification. Values that
 * would be interpreted as a spreadsheet formula are neutralized with a
 * leading tab (cmd_324 SA-2).
 */
export function escapeCSV(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date
    ? v.toISOString()
    : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (FORMULA_TRIGGER.test(s)) s = '\t' + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Strip the tab escape prefix added by escapeCSV() for formula-trigger characters. */
export function unescapeImportValue(v: string): string {
  if (/^\t[=+\-@]/.test(v)) return v.slice(1);
  return v;
}
