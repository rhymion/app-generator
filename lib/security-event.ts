/**
 * Security-event log: failed authentication, authorization denials and
 * rate-limit hits on the REST surface.
 *
 * One fixed vocabulary, one line per event, written through `logger` (process
 * output). It deliberately does not write to `audit_log`: these events are
 * produced by unauthenticated callers, and a database row per probe would let
 * a caller grow an append-only table. The list of events is in
 * docs/knowledge/logging-inventory.md.
 *
 * A record carries only the event name, the HTTP status and the error code.
 * It never carries a user id, an email, an address, a credential, a request
 * path or the error message (messages can name entities or roles).
 */
import { logger } from '@/lib/logger';

export type SecurityEventName = 'auth.rejected' | 'authz.denied' | 'rate_limit.hit';

export type SecurityEvent = {
  event: SecurityEventName;
  status: number;
  code?: string;
};

/** Maps an HTTP status to a security event, or null when the status is not one. */
export function securityEventForStatus(status: number): SecurityEventName | null {
  if (status === 401) return 'auth.rejected';
  if (status === 403) return 'authz.denied';
  if (status === 429) return 'rate_limit.hit';
  return null;
}

export function logSecurityEvent(e: SecurityEvent): void {
  logger.warn(
    '[security-event]',
    JSON.stringify({
      at: new Date().toISOString(),
      event: e.event,
      status: e.status,
      ...(e.code ? { code: e.code } : {}),
    }),
  );
}

// Errors already written as a security event. A permission check raises its
// error where the denial happens (so Server Actions are covered); a REST route
// then passes the same error to handleApiError, which must not write it twice.
const logged = new WeakSet<object>();

/** Logs a permission denial once and remembers the error that carries it. */
export function logAuthzDenied(error: object, code = 'PERMISSION_DENIED'): void {
  if (logged.has(error)) return;
  logged.add(error);
  logSecurityEvent({ event: 'authz.denied', status: 403, code });
}

export function wasSecurityEventLogged(error: object): boolean {
  return logged.has(error);
}

/**
 * A refused web sign-in (wrong or missing credentials, wrong second-factor
 * code). The record holds a fixed reason code only: never the email that was
 * tried, which for an unknown account is attacker-supplied text.
 */
export function logSignInRejected(code: 'INVALID_CREDENTIALS' | 'INVALID_MFA_CODE'): void {
  logSecurityEvent({ event: 'auth.rejected', status: 401, code });
}
