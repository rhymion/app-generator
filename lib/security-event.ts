/**
 * Security-event log: failed authentication, authorization denials and
 * rate-limit hits, on REST routes and in Server Actions.
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
import { AppError, type ErrorCode } from '@/lib/_errors';
import { ApiError } from '@/lib/api-error';

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

// Errors already written as a security event. One error can pass several
// places that log: a permission check raises it where the denial happens, then
// a Server Action catch, handleApiError or onRequestError sees the same object.
// Only the first one writes.
const logged = new WeakSet<object>();

/** Logs the event for an error once and remembers the error that carried it. */
export function logSecurityEventOnce(error: object, e: SecurityEvent): void {
  if (logged.has(error)) return;
  logged.add(error);
  logSecurityEvent(e);
}

/** Logs a permission denial once and remembers the error that carries it. */
export function logAuthzDenied(error: object, code = 'PERMISSION_DENIED'): void {
  logSecurityEventOnce(error, { event: 'authz.denied', status: 403, code });
}

export function wasSecurityEventLogged(error: object): boolean {
  return logged.has(error);
}

/** HTTP status a REST route answers for each AppError code (handleApiError). */
export const APP_ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  SESSION_EXPIRED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RESERVATION_LOCKED: 409,
  RELATED_RECORD_INVALID: 422,
  CAPACITY: 409,
  RATE_LIMITED: 429,
  UNKNOWN: 500,
};

/**
 * Writes the security event an error stands for (401, 403, 429), once per error
 * object. handleApiError calls it for REST routes; a Server Action calls it in
 * the catch that turns an error into an ActionFailure, and onRequestError
 * (lib/request-error.ts) calls it for an error that left the action uncaught. A
 * denial therefore logs the same event whichever surface refused it, including
 * one thrown by hand as `new AppError('PERMISSION_DENIED', ...)` (Issue #1307).
 * Any other value (a NOT_FOUND or VALIDATION AppError, a plain Error) writes
 * nothing.
 */
export function logSecurityEventForError(error: unknown): void {
  if (error instanceof ApiError) {
    const event = securityEventForStatus(error.statusCode);
    if (event) logSecurityEventOnce(error, { event, status: error.statusCode });
    return;
  }
  if (error instanceof AppError) {
    const status = APP_ERROR_STATUS_MAP[error.code] ?? 500;
    const event = securityEventForStatus(status);
    if (event) logSecurityEventOnce(error, { event, status, code: error.code });
  }
}

/**
 * A refused web sign-in (wrong or missing credentials, wrong second-factor
 * code). The record holds a fixed reason code only: never the email that was
 * tried, which for an unknown account is attacker-supplied text.
 */
export function logSignInRejected(code: 'INVALID_CREDENTIALS' | 'INVALID_MFA_CODE'): void {
  logSecurityEvent({ event: 'auth.rejected', status: 401, code });
}
