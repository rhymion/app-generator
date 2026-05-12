import { NextRequest, NextResponse } from 'next/server';
import { clearApiKeyCache } from '@/lib/api-auth';
import { invalidatePermissionCache } from '@/lib/authz';

/**
 * POST /api/test-utils/reset-caches
 *
 * Clears the in-process api-key and permission LRUs so cypress can call this
 * after `cy.task('db:reset')` and avoid stale-userId FK violations on the
 * next write.
 *
 * Gated on the `TEST_RESET_TOKEN` env var:
 *  - Unset → endpoint returns 404 (effectively disabled, what production
 *    deployments want).
 *  - Set → caller must echo the token in the `X-Test-Reset-Token` header.
 *
 * The .env.test file sets a token so cypress can clear the cache between
 * tests. Real production deployments leave the var unset and the route
 * disappears.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.TEST_RESET_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const provided = request.headers.get('X-Test-Reset-Token');
  if (provided !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  clearApiKeyCache();
  await invalidatePermissionCache();
  return NextResponse.json({ ok: true });
}
