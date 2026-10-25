// Allow-list check for URLs that are rendered into `href` / `src` attributes
// from stored values (for example an uploaded file's URL).
//
// A value is accepted only when it is an absolute http(s) URL or a
// root-relative path. Protocol-relative values (`//host/...`), backslash
// variants and any other scheme (`javascript:`, `data:`, ...) are rejected.

export function isSafeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return false;
  if (value.startsWith('/')) {
    return !value.startsWith('//') && !value.startsWith('/\\');
  }
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
