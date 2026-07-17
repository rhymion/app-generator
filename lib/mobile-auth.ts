/**
 * Mobile token auth (cmd_354/357) — access/refresh token issuance and
 * access-token verification shared by `app/api/mobile/auth/*` and
 * `authenticate()` in `lib/api-auth.ts`.
 *
 * Signing key: the access token is signed with the same AUTH_SECRET as
 * NextAuth's web JWT (354a section_3). The `type: "mobile_access"` claim is
 * the ONLY thing that distinguishes a mobile access token from a web
 * session JWT — auth.ts's `jwt()` callback never sets `type`. Every
 * verification path MUST check this claim (cmd_357 condition 2); skipping
 * it anywhere would let a web session JWT be accepted as a mobile token or
 * vice versa.
 */
import { NextResponse } from 'next/server';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createHmac, randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';

/**
 * CORS for `app/api/mobile/auth/*` only. `app.json`'s mobile target
 * includes "web" (react-native-web / `expo start --web` / a deployed web
 * build), which — unlike the native iOS/Android app — is subject to
 * browser CORS enforcement and may run on a different origin than the API
 * (e.g. local dev: Expo web on :8082, Next.js on :3000). No other route in
 * this app sends CORS headers; scoped here rather than in `handleApiError`
 * so this doesn't change behavior for the existing REST/CRUD API surface.
 * `*` is safe with the `Authorization` header because mobile auth never
 * uses cookie credentials (`credentials: 'include'`) — it's Bearer-only.
 */
export function withMobileCors(response: NextResponse): NextResponse {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

export function mobileCorsPreflight(): NextResponse {
  return withMobileCors(new NextResponse(null, { status: 204 }));
}

export const MOBILE_ACCESS_TOKEN_TYPE = 'mobile_access';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 900s (354a section_3)
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (354a section_3)

export class MobileAuthError extends Error {}

function authSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

export interface MobileAccessTokenPayload extends JWTPayload {
  sub: string;
  session_id: string;
  type: typeof MOBILE_ACCESS_TOKEN_TYPE;
}

/** JWT is 3 dot-separated segments; an API key is a `mk_`-prefixed hex string. */
export function isMobileJwt(token: string): boolean {
  return token.split('.').length === 3;
}

export async function signMobileAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ session_id: sessionId, type: MOBILE_ACCESS_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setJti(createId())
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(authSecretKey());
}

/**
 * Verify a mobile access token: signature + expiry (jose) and the `type`
 * claim (rejects NextAuth web JWTs). Deliberately stateless — no DB lookup
 * (354a DP-2, Option A, Lord-approved): the mobile_session row is only
 * consulted at issuance/rotation/revocation time, not on every
 * access-token-authenticated request. Consequence of that choice: a token
 * issued just before logout / device revocation stays valid for up to its
 * remaining ~15-minute lifetime — an accepted, explicitly-recorded window,
 * not a bug. See subtask_357a report for the DP-2 debt note.
 */
export async function verifyMobileAccessToken(
  token: string,
): Promise<{ userId: string; sessionId: string }> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, authSecretKey(), { algorithms: ['HS256'] }));
  } catch {
    throw new MobileAuthError('Invalid or expired access token');
  }

  if (payload.type !== MOBILE_ACCESS_TOKEN_TYPE) {
    throw new MobileAuthError('Invalid token type');
  }
  const userId = payload.sub;
  const sessionId = payload.session_id;
  if (typeof userId !== 'string' || typeof sessionId !== 'string') {
    throw new MobileAuthError('Malformed token payload');
  }

  return { userId, sessionId };
}

export function generateRefreshTokenPlaintext(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Deterministic (HMAC-SHA256 keyed on AUTH_SECRET), NOT bcrypt.
 *
 * Correction to 354a section_6/section_2, which specified a bcrypt hash for
 * `refresh_token_hash` while also specifying `findUnique({ where: {
 * refresh_token_hash } })` for rotation lookup. Those two are mutually
 * exclusive: bcrypt salts every hash differently, so re-hashing the same
 * incoming token never matches a previously-stored bcrypt hash — the
 * lookup would always miss. A deterministic hash is required for the O(1)
 * unique-index lookup the rotation/reuse-detection flow depends on. This is
 * safe here because — unlike a password — the refresh token is already a
 * cryptographically random 256-bit value; a slow salted hash buys no
 * additional brute-force resistance, and keying the HMAC on AUTH_SECRET
 * means a raw DB dump alone still isn't enough to validate a guessed token.
 */
export function hashRefreshToken(token: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  return createHmac('sha256', secret).update(token).digest('hex');
}
