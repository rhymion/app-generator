/**
 * Default security response headers for every route (wired in next.config.ts).
 *
 * A Content-Security-Policy that restricts scripts and styles is deliberately
 * not part of this set; the only CSP directive sent is `frame-ancestors`, so
 * no page can be embedded in another origin's frame. An app whose own
 * hand-written pages must be embedded or need other headers edits this list
 * (or the `headers()` entry in next.config.ts).
 */
export interface SecurityHeader {
  key: string;
  value: string;
}

export const SECURITY_HEADERS: SecurityHeader[] = [
  // Browsers ignore this over plain http, so local development is unaffected.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];
