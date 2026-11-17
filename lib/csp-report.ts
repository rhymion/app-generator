/**
 * Reduce a browser Content Security Policy violation report to the fields that identify the
 * violation. Everything else is dropped: `referrer`, `source-file`, `line-number`, `script-sample`
 * and the original policy can carry query strings, inline script text or other request data.
 */
export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
  disposition?: string;
}

const MAX_FIELD_LENGTH = 200;
const MAX_REPORTS = 20;

/** Keep scheme, host and path of a URL; drop the query string, fragment and credentials. */
export function stripUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, MAX_FIELD_LENGTH);
  } catch {
    // Keywords such as "inline", "eval" or "data" are not URLs; keep short plain words only.
    return /^[a-z-]{1,32}$/i.test(value) ? value : '';
  }
}

function word(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/i.test(value) ? value : '';
}

function fromRecord(record: Record<string, unknown>): CspViolation | null {
  const directive = word(record['effective-directive'] ?? record.effectiveDirective ?? record['violated-directive'] ?? record.violatedDirective);
  if (!directive) return null;
  const violation: CspViolation = {
    directive,
    blocked: stripUrl(record['blocked-uri'] ?? record.blockedURL ?? record.blockedUri),
    page: stripUrl(record['document-uri'] ?? record.documentURL ?? record.documentUri),
  };
  const disposition = word(record.disposition);
  if (disposition) violation.disposition = disposition;
  return violation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepts a `{ "csp-report": {...} }` object or a Reporting API array of `{ type, body }` items. */
export function extractCspViolations(payload: unknown): CspViolation[] {
  const found: CspViolation[] = [];
  if (isRecord(payload) && isRecord(payload['csp-report'])) {
    const v = fromRecord(payload['csp-report']);
    if (v) found.push(v);
  } else if (Array.isArray(payload)) {
    for (const item of payload.slice(0, MAX_REPORTS)) {
      if (isRecord(item) && item.type === 'csp-violation' && isRecord(item.body)) {
        const v = fromRecord(item.body);
        if (v) found.push(v);
      }
    }
  }
  return found;
}
