import { NextRequest, NextResponse } from 'next/server';
import { authenticate, handleApiError } from '@/lib/api-auth';
import { getModelPermissions, toPermissions } from '@/lib/authz';

// Entity names are lowercase snake_case model names (the same names the REST routes use).
const ENTITY_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * GET /api/mobile/permissions?entity=<name> — the caller's model-level flags
 * for one entity: `{ create, read, update, delete, import }`.
 *
 * The mobile screens need `create` before any record exists (to show or hide
 * the "New" action), which the row-level capabilities route cannot answer. The
 * answer comes from the same `getModelPermissions()` every other route uses.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticate(request);
    const entity = request.nextUrl.searchParams.get('entity') ?? '';
    if (!ENTITY_NAME.test(entity)) {
      return NextResponse.json({ error: 'entity query parameter is required' }, { status: 400 });
    }
    const { permissions } = await getModelPermissions(entity, userId);
    return NextResponse.json(await toPermissions(permissions));
  } catch (error) {
    return handleApiError(error);
  }
}
