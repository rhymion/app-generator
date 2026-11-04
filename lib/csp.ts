/**
 * Content Security Policy (report-only) with a per-request nonce.
 *
 * proxy.ts creates a nonce for every page request and sends this policy as
 * `Content-Security-Policy-Report-Only`. The browser only reports what the
 * policy would block (to `/api/security/csp-report`); nothing is blocked. The
 * enforced `frame-ancestors 'none'` header in lib/security-headers.ts is a
 * separate header and is not affected. See docs/knowledge/content-security-policy.md.
 */

/** Request header that carries the nonce from proxy.ts to the root layout. */
export const CSP_NONCE_HEADER = 'x-nonce';

/** Route that receives violation reports. */
export const CSP_REPORT_PATH = '/api/security/csp-report';

/** Environment variable: extra origins for `script-src` (analytics tags, payment widgets, ...). */
export const CSP_EXTRA_SCRIPT_SRC_ENV = 'CSP_EXTRA_SCRIPT_SRC';

/** Environment variable: extra origins for `img-src`, `media-src` and `connect-src` (file storage buckets, CDNs). */
export const CSP_EXTRA_STORAGE_SRC_ENV = 'CSP_EXTRA_STORAGE_SRC';

// A source expression is a scheme or origin made of URL characters only. Anything with a quote,
// semicolon, comma or whitespace would let an environment value add a directive or end the header,
// so such entries are dropped. Keyword sources such as 'unsafe-inline' are not accepted either.
const SOURCE_EXPRESSION = /^(?:[a-z][a-z0-9+.-]*:|(?:[a-z][a-z0-9+.-]*:\/\/)?(?:\*\.)?[a-z0-9.-]+(?::(?:\d{1,5}|\*))?(?:\/[A-Za-z0-9._~%/-]*)?)$/i;

/** Split a space- or comma-separated list of origins and keep the valid ones. */
export function parseSourceList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .filter((entry) => entry.length > 0 && SOURCE_EXPRESSION.test(entry));
}

/** 128 random bits, base64 encoded (works in the Node.js and edge runtimes). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface CspOptions {
  nonce: string;
  extraScriptSrc?: string[];
  extraStorageSrc?: string[];
  /** Next.js development needs eval for fast refresh and source maps. */
  development?: boolean;
}

/** Build the value of the `Content-Security-Policy-Report-Only` header. */
export function buildCspReportOnly({ nonce, extraScriptSrc = [], extraStorageSrc = [], development = false }: CspOptions): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, ...extraScriptSrc];
  if (development) scriptSrc.push("'unsafe-eval'");
  const storage = extraStorageSrc;
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', scriptSrc],
    // Emotion (MUI) inserts <style> tags that carry the nonce; the style attribute is allowed
    // separately because React renders `style={{ ... }}` as inline style attributes.
    ['style-src', ["'self'", `'nonce-${nonce}'`]],
    ['style-src-attr', ["'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...storage]],
    ['media-src', ["'self'", 'blob:', ...storage]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...storage]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['report-uri', [CSP_REPORT_PATH]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

/** The report-only header value for one request, with origins taken from the environment. */
export function cspReportOnlyFromEnv(nonce: string, env: Record<string, string | undefined> = process.env): string {
  return buildCspReportOnly({
    nonce,
    extraScriptSrc: parseSourceList(env[CSP_EXTRA_SCRIPT_SRC_ENV]),
    extraStorageSrc: parseSourceList(env[CSP_EXTRA_STORAGE_SRC_ENV]),
    development: env.NODE_ENV === 'development',
  });
}
