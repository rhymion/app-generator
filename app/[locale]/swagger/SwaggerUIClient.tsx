'use client';

import { useEffect, useRef } from 'react';
import { SwaggerUIBundle } from 'swagger-ui-dist';
import 'swagger-ui-dist/swagger-ui.css';

/**
 * Mounts swagger-ui-dist — not swagger-ui-react — against GET
 * /api/openapi.json. swagger-ui-dist is the same core engine as
 * swagger-ui-react but ships as a React-independent vanilla JS/CSS bundle,
 * which sidesteps swagger-ui-react's long-running React 19
 * peer-dependency churn (swagger-api/swagger-ui#10243) and, being React
 * version-independent, won't hit the same class of issue on the next React
 * major either. See docs/knowledge/generated-documentation-and-openapi-spec.md
 * for the full library comparison.
 *
 * `url: '/api/openapi.json'` is same-origin, so the browser attaches the
 * page's own session cookie automatically when swagger-ui-dist fetches the
 * spec — no credentials wiring needed here, and no CORS is opened. The
 * securitySchemes the generated spec declares (ApiKeyHeader / ApiKeyBearer)
 * drive swagger-ui-dist's built-in Authorize dialog, which then attaches
 * whatever key is entered to every "Try it out" call — also same-origin.
 */
export default function SwaggerUIClient() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    SwaggerUIBundle({
      url: '/api/openapi.json',
      domNode: containerRef.current,
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
    });
  }, []);

  return <div ref={containerRef} />;
}
