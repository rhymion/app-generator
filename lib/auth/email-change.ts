/**
 * Verified email change (Issue #1400, docs/knowledge/authentication.md "Changing the email address").
 *
 * With email verification on (`siteConfig.auth.registration.emailVerification`), a new address is
 * not stored when the account settings are saved. `startEmailChange()` mails a single-use link to
 * the new address and a notice to the current one; the address changes only when the link is used
 * (POST /api/auth/email-change/complete, `completeEmailChange()`). Until then the current address
 * keeps working for sign-in and mail. The notice to the current address carries a link that cancels
 * the pending change (POST /api/auth/email-change/cancel, `cancelPendingEmailChange()`). With email verification off none of this runs and an email
 * change is stored at once, as before.
 */
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { getRateLimiter } from '@/lib/rate-limit';
import { siteConfig } from '@/lib/site-config';
import { sendMail } from '@/lib/mail';
import { recordAuditEvent } from '@/lib/audit-log';
import { resolveExternalUrl } from '@/lib/auth/external-url';
import { registrationLocale } from '@/lib/auth/registration-mail';
import { normalizeEmail } from '@/lib/auth/registration-token';
import {
  cancelEmailChange,
  consumeEmailChangeCancelToken,
  consumeEmailChangeToken,
  issueEmailChangeCancelToken,
  issueEmailChangeToken,
} from '@/lib/auth/email-change-token';
import { currentSessionRef } from '@/lib/auth/current-session';
import { endOtherSessions } from '@/lib/auth/web-session';
import { buildEmailChangeMail } from '@/lib/auth/email-change-mail';
import { isRegistrationEmailAllowed, registrationAllowedDomains } from '@/lib/auth/domain-allow-list';

const MAX_EMAIL_LENGTH = 320;

export function emailChangeNeedsVerification(): boolean {
  return Boolean(siteConfig.auth.registration?.emailVerification);
}

/** Same per-address key as the register route's `auth:register:email` bucket. */
function emailBucketKey(email: string): string {
  return createHash('sha256').update(email, 'utf8').digest('hex');
}

/** Scheme, host and locale of the current request (a Route Handler or a Server Action). */
async function requestOriginAndLocale(): Promise<{ origin: string; locale: string }> {
  const h = await headers();
  const { protocol, host } = resolveExternalUrl({
    forwardedHost: h.get('x-forwarded-host'),
    forwardedProto: h.get('x-forwarded-proto'),
    hostHeader: h.get('host'),
    nextUrl: new URL(`http://${h.get('host') ?? 'localhost'}/`),
  });
  let locale: string | undefined;
  try {
    locale = await getLocale();
  } catch {
    locale = undefined;
  }
  return { origin: `${protocol}://${host}`, locale: registrationLocale(locale) };
}

/**
 * Starts a verified change of `userId`'s address to `newEmail`: a link to the new address and a
 * notice to `currentEmail`. Replaces any earlier pending change of the account. Sends nothing when
 * the new address belongs to another account or its per-address mail budget
 * (`auth:register:email`) is spent; the caller's answer is the same either way, so a settings save
 * does not reveal which addresses are registered.
 */
export async function startEmailChange(input: { userId: string; currentEmail: string; newEmail: string }): Promise<void> {
  const newEmail = normalizeEmail(input.newEmail);
  if (!newEmail || newEmail.length > MAX_EMAIL_LENGTH || !newEmail.includes('@')) return;

  const taken = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
  if (taken) return;
  const perAddress = await getRateLimiter().check('auth:register:email', emailBucketKey(newEmail));
  if (!perAddress.allowed) return;

  const { origin, locale } = await requestOriginAndLocale();
  const token = await issueEmailChangeToken(prisma, input.userId, newEmail);
  const cancelToken = await issueEmailChangeCancelToken(prisma, input.userId);
  await sendMail(await buildEmailChangeMail({ kind: 'confirm', to: newEmail, locale, origin, token }));
  await notify(input.currentEmail, 'requested', locale, origin, cancelToken);
  await recordAuditEvent({
    action: 'auth:emailChange.request',
    actor_user_id: input.userId,
    target_table: 'user',
    target_id: input.userId,
  });
}

async function notify(
  to: string,
  kind: 'requested' | 'completed',
  locale: string,
  origin: string,
  token?: string,
): Promise<void> {
  try {
    await sendMail(await buildEmailChangeMail({ kind, to, locale, origin, token }));
  } catch (err) {
    // The notice is informational; a failed send must not undo or block the change itself.
    logger.error('[email-change] notice to the current address failed', {
      kind,
      name: err instanceof Error ? err.name : typeof err,
    });
  }
}

export type EmailChangeResult = { ok: true } | { ok: false; reason: 'invalid' | 'taken' | 'not_allowed' };

/**
 * Uses an email change link: stores the new address (marked verified) on the account the link was
 * issued for and notifies the previous address. `invalid` covers an unknown, expired or used link
 * and an account that no longer exists or was erased; `taken` means another account got the
 * address after the link was sent; `not_allowed` means the new address's domain is no longer on the
 * registration domain allow-list (Issue #1402), which may have changed since the link was sent.
 */
export async function completeEmailChange(token: unknown, locale: string, origin: string): Promise<EmailChangeResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    const request = await consumeEmailChangeToken(tx, token);
    if (!request) return { ok: false as const, reason: 'invalid' as const };
    // Issue #1402: the settings save already refused such an address; the list may have been
    // narrowed since the link was sent. The link is used up either way.
    if (!isRegistrationEmailAllowed(request.newEmail, registrationAllowedDomains(siteConfig.auth))) {
      return { ok: false as const, reason: 'not_allowed' as const };
    }
    const user = await tx.user.findUnique({
      where: { id: request.userId },
      select: { id: true, email: true, anonymized_at: true },
    });
    if (!user || user.anonymized_at) return { ok: false as const, reason: 'invalid' as const };
    const other = await tx.user.findUnique({ where: { email: request.newEmail }, select: { id: true } });
    if (other && other.id !== user.id) return { ok: false as const, reason: 'taken' as const };
    // The account settings service needs every field of the form; this path changes one
    // attribute of the account the link proves, like the password reset route does.
    await tx.user.update({
      where: { id: user.id },
      data: { email: request.newEmail, emailVerified: new Date(), updater_id: user.id },
    });
    // The cancel link mailed to the previous address has nothing left to cancel.
    await cancelEmailChange(tx, user.id);
    // The address is a credential (sign-in, password reset): the user's other sessions end with the
    // change, in the same transaction. The browser that used the link keeps its session when it is
    // signed in as the user.
    const ended = await endOtherSessions(user.id, await currentSessionRef(user.id), tx);
    await recordAuditEvent({
      action: 'auth:sessions.endOthers',
      actor_user_id: user.id,
      target_table: 'user',
      target_id: user.id,
      metadata: { web: ended.web, mobile: ended.mobile },
      tx,
    });
    await recordAuditEvent({
      action: 'auth:emailChange.complete',
      actor_user_id: user.id,
      target_table: 'user',
      target_id: user.id,
      tx,
    });
    return { ok: true as const, previousEmail: user.email };
  });
  if (!outcome.ok) return outcome;
  if (outcome.previousEmail) await notify(outcome.previousEmail, 'completed', locale, origin);
  return { ok: true };
}

export type EmailChangeCancelResult = { ok: true } | { ok: false; reason: 'invalid' };

/**
 * Uses a cancel link from the notice sent to the current address: removes the account's pending
 * email change link, so the new address can no longer be confirmed. `invalid` covers an unknown,
 * expired or used cancel link, one whose change was already completed or replaced by a newer
 * request, and an erased account. Holding the link proves control of the current address, the
 * same proof the account already relies on, so it needs no session.
 */
export async function cancelPendingEmailChange(token: unknown): Promise<EmailChangeCancelResult> {
  return prisma.$transaction(async (tx) => {
    const userId = await consumeEmailChangeCancelToken(tx, token);
    if (!userId) return { ok: false as const, reason: 'invalid' as const };
    const user = await tx.user.findUnique({ where: { id: userId }, select: { anonymized_at: true } });
    const removed = await cancelEmailChange(tx, userId);
    if (!user || user.anonymized_at || removed === 0) return { ok: false as const, reason: 'invalid' as const };
    await recordAuditEvent({
      action: 'auth:emailChange.cancel',
      actor_user_id: userId,
      target_table: 'user',
      target_id: userId,
      tx,
    });
    return { ok: true as const };
  });
}
