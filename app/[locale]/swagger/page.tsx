import { notFound } from 'next/navigation';
import SwaggerUIClient from './SwaggerUIClient';

// Security-sensitive gate (Issue #768): re-evaluate SWAGGER_UI_ENABLED on
// every request instead of letting Next.js statically cache a single
// build-time render of this page.
export const dynamic = 'force-dynamic';

/**
 * GET /swagger (Issue #768) — development/staging-only interactive API
 * explorer.
 *
 * Gated on SWAGGER_UI_ENABLED, never NODE_ENV: `next build` always bakes
 * NODE_ENV=production into the bundle regardless of the actual deployment
 * target (.env.example), so it can't tell a real production deploy apart
 * from a staging one. Unset means this page 404s, mirroring the
 * TEST_RESET_TOKEN pattern (app/api/test-utils/reset-caches/route.ts):
 * unset disables the route entirely rather than showing a disabled state.
 * Not wired into any Vercel automation script (vercel-setup.sh /
 * vercel-env.sh) — see docs/knowledge/generated-documentation-and-openapi-spec.md
 * for the manual Preview-only enablement steps.
 *
 * proxy.ts is the authoritative gate: it returns a real 404 before this page
 * ever renders (a page-level `notFound()` call here, alone, serves 200 —
 * app/[locale]/loading.tsx's Suspense boundary already commits the status
 * line to 200 by the time this component runs). The check below is kept
 * only as a defense-in-depth backstop.
 *
 * Login is enforced by proxy.ts, which requires a session for every path not
 * listed in its PUBLIC_PATHS — this page is deliberately not added there, so
 * an unauthenticated visitor is redirected to /login before ever reaching
 * this check. It also does not live under /docs (the public MDX docs path).
 */
export default function SwaggerPage() {
  if (process.env.SWAGGER_UI_ENABLED !== 'true') {
    notFound();
  }
  return <SwaggerUIClient />;
}
