'use server';

import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow } from '@/lib/authz';
import { generateApiKey, hashApiKey } from '@/lib/api-key';
import { invalidateApiKeyCache } from '@/lib/api-auth';
import { recordAuditEvent } from '@/lib/audit-log';

export type ApiKeyStatus = {
  isSet: boolean;
  issuedAt: string | null;
  expiresAt: string | null;
};

/**
 * What the settings page may know about the session user's API key: whether one
 * is set, when it was issued and when it expires. The key itself is not stored
 * and cannot be shown again.
 */
export async function getApiKeyStatus(): Promise<ApiKeyStatus> {
  const userId = await getSessionUserIdOrThrow();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { api_key_hash: true, api_key_issued_at: true, api_key_expires_at: true },
  });
  return {
    isSet: Boolean(user?.api_key_hash),
    issuedAt: user?.api_key_issued_at?.toISOString() ?? null,
    expiresAt: user?.api_key_expires_at?.toISOString() ?? null,
  };
}

/**
 * Issues a new API key for the session user and returns it. This is the only
 * time the key exists in readable form: the database receives its SHA-256 hash.
 * The previous key stops working at once, including in this process's
 * authentication cache. `api_key_expires_at` is left as it was.
 */
export async function issueApiKey(): Promise<{ apiKey: string; status: ApiKeyStatus }> {
  const userId = await getSessionUserIdOrThrow();
  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { api_key_hash: true },
  });
  const apiKey = generateApiKey();
  const issuedAt = new Date();
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { api_key_hash: hashApiKey(apiKey), api_key_issued_at: issuedAt },
    select: { api_key_expires_at: true },
  });
  invalidateApiKeyCache(previous?.api_key_hash);
  await recordAuditEvent({
    action: 'auth:apikey.issue',
    actor_user_id: userId,
    target_table: 'user',
    target_id: userId,
  });
  return {
    apiKey,
    status: {
      isSet: true,
      issuedAt: issuedAt.toISOString(),
      expiresAt: updated.api_key_expires_at?.toISOString() ?? null,
    },
  };
}
