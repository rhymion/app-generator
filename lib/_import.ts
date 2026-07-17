import crypto from 'crypto';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function generateImportToken(actorId: string, entity: string): string {
  const exp = (Date.now() + TOKEN_TTL_MS).toString();
  const payload = `${actorId}:${entity}:${exp}`;
  const sig = crypto
    .createHmac('sha256', process.env.AUTH_SECRET ?? '')
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifyImportToken(
  token: string | undefined,
  actorId: string,
  entity: string,
): boolean {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const lastColon = decoded.lastIndexOf(':');
    const payload  = decoded.slice(0, lastColon);
    const tSig     = decoded.slice(lastColon + 1);
    const parts    = payload.split(':');
    if (parts.length !== 3) return false;
    const [tActor, tEntity, tExp] = parts;
    if (tActor !== actorId || tEntity !== entity) return false;
    if (Date.now() > parseInt(tExp, 10)) return false;
    const expected = crypto
      .createHmac('sha256', process.env.AUTH_SECRET ?? '')
      .update(payload)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(tSig, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}
