// Fixture-only stand-in for @/lib/authz (subtask_753a payment-gate check).
// Only `getSessionUserId` is needed here -- it's the one authz export the
// Stripe checkout route stub (stripe_checkout_route_stub.ts.jinja2) calls.
// The real lib/authz.ts is not used because its implementation imports
// @/lib/prisma expecting the full production `user` model, which this
// fixture's Prisma schema intentionally does not carry. Mirrors
// tests/fixtures/decimal_gate/shims/authz.ts, trimmed to the one signature
// this fixture's included files actually reference.
export async function getSessionUserId(): Promise<string | null> {
  throw new Error('fixture stub');
}
