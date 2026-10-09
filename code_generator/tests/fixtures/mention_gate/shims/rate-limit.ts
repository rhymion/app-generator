// Fixture-only stand-in for @/lib/rate-limit -- see lib/authz.ts in this same
// directory for why (see the mention-gate check).
export function getRateLimiter(): {
  check(bucket: string, key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
} {
  throw new Error('fixture stub');
}
