import fs from 'node:fs';
import path from 'node:path';

/**
 * The generated OpenAPI document (code_generator/generators_openapi.py,
 * written by `generate.py` to docs/generated/openapi.json) is a build
 * artifact, not part of the source tree — docs/generated/ is gitignored and
 * only exists once `generate-code` has run. GET /api/openapi.json (Issue
 * #769) reads it at request time via a runtime-built path rather than a
 * static `import`, so a checkout that skips `generate-code` still type-checks
 * and lints; the same reasoning that keeps lib/legal/content.ts's
 * content/legal/*.md reads on `fs.readFileSync` + a runtime-built path
 * instead of a static import.
 *
 * `fs.readFileSync` with a computed path can't be statically traced by
 * Vercel's build-time output file tracer, so next.config.ts's
 * `outputFileTracingIncludes` explicitly lists this file — the same
 * treatment content/legal/*.md already gets there.
 */
const OPENAPI_DOCUMENT_PATH = path.join(process.cwd(), 'docs', 'generated', 'openapi.json');

/**
 * Returns the parsed OpenAPI document, or null when it hasn't been
 * generated for this deployment (e.g. a checkout that ran `next build`
 * without first running `generate-code` — never true on Vercel, where
 * `vercel-build` chains `prj:sync` -> `python-generate` -> ... -> `build`).
 */
export function readGeneratedOpenApiDocument(): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(OPENAPI_DOCUMENT_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
