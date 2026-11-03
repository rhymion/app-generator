/**
 * Default security response headers for every route (wired in next.config.ts).
 *
 * The enforced Content-Security-Policy in this set carries only `frame-ancestors`, so
 * no page can be embedded in another origin's frame. The script and style policy is sent
 * separately by proxy.ts as `Content-Security-Policy-Report-Only` with a per-request nonce
 * (lib/csp.ts, docs/knowledge/content-security-policy.md). An app whose own
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

/**
 * Every API response is for an authenticated caller, so none may be stored by
 * a browser or a shared cache (ASVS V14.3.2). The attachment route sets its
 * own `private, no-store` and is left out so its header is not doubled.
 * Signed-in page responses get the same header from proxy.ts.
 */
export const API_NO_STORE_SOURCE = '/api/:path((?!attachments/).*)';
export const API_NO_STORE_HEADERS: SecurityHeader[] = [{ key: 'Cache-Control', value: 'no-store' }];
