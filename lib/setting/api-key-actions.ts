'use server';

import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow } from '@/lib/authz';
import { generateApiKey, hashApiKey } from '@/lib/api-key';
import { invalidateApiKeyCache } from '@/lib/api-auth';
import { recordAuditEvent } from '@/lib/audit-log';
import { getDefaultApiKeyExpiry, getDefaultApiKeyExpiryDays, parseRequestedApiKeyExpiry } from '@/lib/api-key-expiry';

export type ApiKeyStatus = {
  isSet: boolean;
  issuedAt: string | null;
  expiresAt: string | null;
  /** True when a key is set and its expiry has passed. */
  expired: boolean;
  /** Days a newly issued key lives unless its owner picks otherwise; null = never expires. */
  defaultExpiryDays: number | null;
};

function toStatus(user: {
  api_key_hash: string | null;
  api_key_issued_at: Date | null;
  api_key_expires_at: Date | null;
} | null): ApiKeyStatus {
  const expiresAt = user?.api_key_expires_at ?? null;
  return {
    isSet: Boolean(user?.api_key_hash),
    issuedAt: user?.api_key_issued_at?.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
    expired: Boolean(user?.api_key_hash) && expiresAt !== null && expiresAt.getTime() <= Date.now(),
    defaultExpiryDays: getDefaultApiKeyExpiryDays(),
  };
}

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
  return toStatus(user);
}

/**
 * Issues a new API key for the session user and returns it. This is the only
 * time the key exists in readable form: the database receives its SHA-256 hash.
 * The previous key stops working at once, including in this process's
 * authentication cache.
 *
 * `expiresAt` is the owner's choice for the new key: an ISO date-time in the
 * future, or `null` for a key that never expires. When it is omitted the site
 * default applies (`siteConfig.auth.apiKeyDefaultExpiryDays`). Only the session
 * user's own key is ever touched, so no other account can set it.
 */
export async function issueApiKey(
  options: { expiresAt?: string | null } = {},
): Promise<{ apiKey: string; status: ApiKeyStatus }> {
  const userId = await getSessionUserIdOrThrow();
  const expiresAt =
    options.expiresAt === undefined ? getDefaultApiKeyExpiry() : parseRequestedApiKeyExpiry(options.expiresAt);
  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { api_key_hash: true },
  });
  const apiKey = generateApiKey();
  const issuedAt = new Date();
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { api_key_hash: hashApiKey(apiKey), api_key_issued_at: issuedAt, api_key_expires_at: expiresAt },
    select: { api_key_hash: true, api_key_issued_at: true, api_key_expires_at: true },
  });
  invalidateApiKeyCache(previous?.api_key_hash);
  await recordAuditEvent({
    action: 'auth:apikey.issue',
    actor_user_id: userId,
    target_table: 'user',
    target_id: userId,
  });
  return { apiKey, status: toStatus(updated) };
}

/**
 * Changes or clears the expiry of the session user's current key without
 * issuing a new one. `null` clears it (the key never expires). A date must be in
 * the future. Rejected when the account has no key.
 */
export async function setApiKeyExpiry(expiresAt: string | null): Promise<ApiKeyStatus> {
  const userId = await getSessionUserIdOrThrow();
  const expiry = parseRequestedApiKeyExpiry(expiresAt);
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { api_key_hash: true },
  });
  if (!current?.api_key_hash) {
    throw new Error('There is no API key to set an expiry on.');
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { api_key_expires_at: expiry },
    select: { api_key_hash: true, api_key_issued_at: true, api_key_expires_at: true },
  });
  invalidateApiKeyCache(current.api_key_hash);
  await recordAuditEvent({
    action: 'auth:apikey.expiry',
    actor_user_id: userId,
    target_table: 'user',
    target_id: userId,
  });
  return toStatus(updated);
}
