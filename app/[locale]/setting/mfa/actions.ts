'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { getSessionUserIdOrThrow } from '@/lib/authz';
import {
  completeEnrollment,
  disableMfa,
  regenerateRecoveryCodes,
  startEnrollment,
} from '@/lib/mfa/enrollment';
import { recordAuditEvent } from '@/lib/audit-log';

/**
 * Server actions that back `/setting/mfa`. Each one re-fetches the session
 * id rather than trusting form-supplied user identifiers — the page is
 * always operating on the currently-signed-in user.
 *
 * Errors are returned as the action's resolved value (instead of throwing)
 * so the client can render a useful message without an error boundary.
 * `revalidatePath('/setting/mfa')` after every state transition forces
 * the server-rendered status block to refresh.
 */

export type MfaErrorCode =
  | 'INVALID_CODE'
  | 'MFA_NOT_ENABLED'
  | 'MFA_ALREADY_ENABLED'
  | 'SESSION_REQUIRED'
  | 'UNKNOWN_ERROR';

export type ActionResult =
  | { ok: true }
  | { ok: true; recoveryCodes: string[] }
  | { ok: true; qrDataUrl: string; secret: string }
  | { ok: false; error: MfaErrorCode };

function toErrorCode(err: unknown): MfaErrorCode {
  const msg = err instanceof Error ? err.message : '';
  if (msg === 'User not authenticated') return 'SESSION_REQUIRED';
  if (msg === 'MFA already enabled') return 'MFA_ALREADY_ENABLED';
  if (msg === 'Invalid MFA code') return 'INVALID_CODE';
  if (msg === 'MFA_NOT_ENABLED') return 'MFA_NOT_ENABLED';
  if (msg === 'INVALID_CODE') return 'INVALID_CODE';
  return 'UNKNOWN_ERROR';
}

export async function startEnrollmentAction(): Promise<ActionResult> {
  try {
    const userId = await getSessionUserIdOrThrow();
    const { qrDataUrl, secret } = await startEnrollment(userId);
    await recordAuditEvent({
      action: 'auth:mfa.startEnrollment',
      actor_user_id: userId,
      target_table: 'user',
      target_id: userId,
    });
    revalidatePath('/setting/mfa');
    return { ok: true, qrDataUrl, secret };
  } catch (err) {
    return { ok: false, error: toErrorCode(err) };
  }
}

export async function completeEnrollmentAction(code: string): Promise<ActionResult> {
  try {
    const userId = await getSessionUserIdOrThrow();
    const { recoveryCodes } = await completeEnrollment(userId, code);
    await recordAuditEvent({
      action: 'auth:mfa.enabled',
      actor_user_id: userId,
      target_table: 'user',
      target_id: userId,
    });
    revalidatePath('/setting/mfa');
    return { ok: true, recoveryCodes };
  } catch (err) {
    return { ok: false, error: toErrorCode(err) };
  }
}

export async function disableMfaAction(code: string): Promise<ActionResult> {
  try {
    const userId = await getSessionUserIdOrThrow();
    await disableMfa(userId, code);
    await recordAuditEvent({
      action: 'auth:mfa.disabled',
      actor_user_id: userId,
      target_table: 'user',
      target_id: userId,
    });
    revalidatePath('/setting/mfa');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toErrorCode(err) };
  }
}

export type RegenerateResult =
  | { success: true; recoveryCodes: string[] }
  | { success: false; error: MfaErrorCode };

export async function regenerateRecoveryCodesAction(code: string): Promise<RegenerateResult> {
  try {
    const userId = await getSessionUserIdOrThrow();
    const { recoveryCodes } = await regenerateRecoveryCodes(userId, code);
    await recordAuditEvent({
      action: 'auth:mfa.regenerateCodes',
      actor_user_id: userId,
      target_table: 'user',
      target_id: userId,
    });
    revalidatePath('/setting/mfa');
    return { success: true, recoveryCodes };
  } catch (err) {
    return { success: false, error: toErrorCode(err) };
  }
}

/** Re-direct helper used by the cancel button on the pending screen. */
export async function cancelEnrollmentAction(): Promise<never> {
  const userId = await getSessionUserIdOrThrow();
  await disableMfa(userId, '__cancel__').catch(() => {
    // Cancel via the "clear pending secret" branch even when MFA isn't
    // yet enabled: a direct user.update is fine since there's no recovery
    // code state to clean up.
  });
  // Direct update to clear the pending secret regardless of state.
  const prismaModule = await import('@/lib/prisma');
  const prisma = prismaModule.default as unknown as {
    user: { update: (args: { where: { id: string }; data: { mfa_secret: null } }) => Promise<unknown> };
  };
  await prisma.user.update({ where: { id: userId }, data: { mfa_secret: null } });
  revalidatePath('/setting/mfa');
  redirect('/setting/mfa');
}
