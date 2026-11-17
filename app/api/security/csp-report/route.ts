import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getRateLimiter } from '@/lib/rate-limit';
import { clientIp } from '@/lib/rate-limit/client-ip';
import { extractCspViolations } from '@/lib/csp-report';

// Receives Content Security Policy violation reports from the browser. The browser sends them
// without a session, so the route is public; it is rate limited per IP and only writes a log line
// (no database write). Both report formats are accepted: `application/csp-report` (report-uri)
// and `application/reports+json` (Reporting API).
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const decision = await getRateLimiter().check('csp:report', clientIp(request.headers));
  if (!decision.allowed) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } });
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  for (const violation of extractCspViolations(body)) {
    logger.warn('[csp:violation]', violation);
  }
  return new NextResponse(null, { status: 204 });
}
