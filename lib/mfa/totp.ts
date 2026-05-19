/**
 * TOTP helper — thin wrapper over `otplib` v13.
 *
 * v13 swapped the v12-era `authenticator.options = { window: 1 }` global
 * for a functional, async API with per-call options. `verify()` returns
 * `{ valid, delta, ... }`; we only care about `valid`. Verification
 * tolerance is one TOTP step on each side of "now" (`epochTolerance: 30`)
 * to absorb clock skew between the user's phone and our server. Bigger
 * windows drop the brute-force cost below the intended ~10^6 per 30s.
 *
 * The QR `otpauth://` URI labels the entry with `<issuer>:<account>` per
 * the de-facto Google Authenticator convention. `ISSUER` doubles as the
 * group name in most authenticator apps — keep it short and stable.
 */
import { generateSecret as otplibGenerateSecret, generateURI, verify as otplibVerify } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'my-next';
const EPOCH_TOLERANCE_SECONDS = 30; // ±1 step of slack

export function generateSecret(): string {
  return otplibGenerateSecret();
}

export async function otpauthUrl(secret: string, accountLabel: string): Promise<string> {
  return generateURI({
    strategy: 'totp',
    secret,
    label: accountLabel,
    issuer: ISSUER,
  });
}

export async function otpauthQrDataUrl(secret: string, accountLabel: string): Promise<string> {
  const url = await otpauthUrl(secret, accountLabel);
  return QRCode.toDataURL(url, { width: 240, margin: 1 });
}

export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  // Strip whitespace because authenticator apps sometimes show "123 456".
  const normalized = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  try {
    const result = await otplibVerify({
      secret,
      token: normalized,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    return Boolean(result?.valid);
  } catch {
    // `otplib` throws on malformed secrets; treat as a hard fail.
    return false;
  }
}
