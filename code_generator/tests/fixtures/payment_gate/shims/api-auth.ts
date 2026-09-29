// Fixture-only stand-in for @/lib/api-auth (payment-gate check). Only the two
// exports the Stripe checkout route stub
// (stripe_checkout_route_stub.ts.jinja2) calls are declared, with the same
// signatures as the real lib/api-auth.ts. The real file is not used because
// its implementation imports @/lib/prisma and @/lib/authz expecting the full
// production `user` model, which this fixture's Prisma schema intentionally
// does not carry. Mirrors tests/fixtures/uri_kind_gate's api-auth shim.
import type { NextRequest, NextResponse } from 'next/server';

export async function resolveActorId(_request: NextRequest): Promise<string | null> {
  throw new Error('fixture stub');
}

export function handleApiError(_error: unknown): NextResponse {
  throw new Error('fixture stub');
}
