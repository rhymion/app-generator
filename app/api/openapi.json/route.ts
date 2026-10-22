import { NextRequest, NextResponse } from 'next/server';
import { requireDualAuth, handleApiError } from '@/lib/api-auth';
import { readGeneratedOpenApiDocument } from '@/lib/openapi/document';

/**
 * GET /api/openapi.json (Issue #769)
 *
 * Serves the generated OpenAPI document (docs/generated/openapi.json,
 * code_generator/generators_openapi.py) — the exact file the generator
 * writes, never a hand-built second copy. Runs in every environment,
 * including production: the document only describes the API's shape, it
 * never executes a request, so exposing it is safe. Unlike the Swagger UI
 * page (Issue #768, app/[locale]/swagger), this route is not gated by
 * SWAGGER_UI_ENABLED.
 *
 * Auth: API key (X-API-Key / Authorization: Bearer) or a signed-in session
 * — same dual-auth resolution as the approval_request action routes. No
 * further permission check: the document reveals only the schema shape,
 * not row data, so any authenticated caller may read it.
 */
export async function GET(request: NextRequest) {
  try {
    await requireDualAuth(request);
    const document = readGeneratedOpenApiDocument();
    if (!document) {
      return NextResponse.json(
        { error: 'OpenAPI document not generated for this deployment.' },
        { status: 404 },
      );
    }
    return NextResponse.json(document);
  } catch (error) {
    return handleApiError(error);
  }
}
