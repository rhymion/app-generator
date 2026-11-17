import { NextRequest, NextResponse } from 'next/server';
import { requireDualAuth, handleApiError } from '@/lib/api-auth';
import { readGeneratedOpenApiDocument } from '@/lib/openapi/document';
import { filterOpenApiDocumentForUser } from '@/lib/openapi/filter';

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
 * — same dual-auth resolution as the approval_request action routes. The
 * document is limited to the entities the caller may read (an API key follows
 * its owner's permissions); a caller who may read every entity receives the
 * full document. See lib/openapi/filter.ts.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireDualAuth(request);
    const document = readGeneratedOpenApiDocument();
    if (!document) {
      return NextResponse.json(
        { error: 'OpenAPI document not generated for this deployment.' },
        { status: 404 },
      );
    }
    return NextResponse.json(await filterOpenApiDocumentForUser(document, userId));
  } catch (error) {
    return handleApiError(error);
  }
}
