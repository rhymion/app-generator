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
