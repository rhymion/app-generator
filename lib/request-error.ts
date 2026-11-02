// Issue #1304 (ASVS V16.5.4): the server-side record of an unhandled request error, called from
// onRequestError() in instrumentation.ts. Next.js calls that hook for errors thrown while
// rendering a page, running a Route Handler, a Server Action or the proxy, and the client already
// receives only a generic 500 (or the error boundary) for them.
//
// The record carries the error's name, its digest (the id the error page shows the user, so a
// report can be matched to a log line) and where it happened. It deliberately leaves out the error
// message and stack: library and database errors can carry SQL fragments, column names or file
// paths. The query string is dropped from the path because it can carry tokens.
import { logger } from './logger';

export type RequestErrorRequest = { path: string; method: string };
export type RequestErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
};

function pathWithoutQuery(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

export function logRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): void {
  const err = error as { name?: unknown; digest?: unknown } | null;
  logger.error('[request-error] unhandled error', {
    name: typeof err?.name === 'string' ? err.name : 'Error',
    digest: typeof err?.digest === 'string' ? err.digest : undefined,
    method: request.method,
    path: pathWithoutQuery(request.path),
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
  });
}
