/**
 * Request id for audit records (Issue #1306, ASVS V16.2.1).
 *
 * One random id per incoming request, generated on the server the first time
 * something in that request asks for it, and returned unchanged for the rest of
 * the request. Every `audit_log` row written while handling the request carries
 * it in `request_id`, so the rows of one request can be found together.
 *
 * - **Never taken from the client.** An incoming `X-Request-Id` (or any other
 *   correlation header) is ignored: a caller could otherwise choose the id of
 *   its own audit rows, or reuse another request's id to blur the record.
 * - **Per request, without plumbing.** The id is memoized against the request's
 *   `headers()` object, which Next.js keeps for the whole request. This works
 *   in Route Handlers (including `/api/*`, which the proxy does not run for),
 *   Server Actions, Server Components and the Auth.js callbacks.
 * - **Null outside a request.** Scripts, seeds and scheduled jobs run without a
 *   request; `headers()` throws there and the id is `null`.
 *
 * No source address is recorded (option A of Issue #1306): `audit_log` is
 * append-only, so a stored address could never be redacted.
 */
import { randomUUID } from 'node:crypto';

const idsByRequest = new WeakMap<object, string>();

type HeadersFn = () => Promise<object>;

let headersFn: HeadersFn | null = null;

async function loadHeaders(): Promise<HeadersFn> {
  if (!headersFn) {
    const mod = await import('next/headers');
    headersFn = mod.headers as unknown as HeadersFn;
  }
  return headersFn;
}

/** The current request's id, or null when not called while handling a request. */
export async function getRequestId(): Promise<string | null> {
  let requestHeaders: object;
  try {
    requestHeaders = await (await loadHeaders())();
  } catch {
    return null;
  }
  if (!requestHeaders || typeof requestHeaders !== 'object') return null;
  let id = idsByRequest.get(requestHeaders);
  if (!id) {
    id = randomUUID();
    idsByRequest.set(requestHeaders, id);
  }
  return id;
}

/** Test hook: replaces the `headers()` source. Pass null to restore Next.js's. */
export function __setHeadersSourceForTest(fn: HeadersFn | null): void {
  headersFn = fn;
}
