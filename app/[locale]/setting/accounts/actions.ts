'use server';

import { revalidatePath } from 'next/cache';

import { signIn } from '@/auth';
import { getSessionUserIdOrThrow } from '@/lib/authz';
import {
  DetachAccountError,
  detachAccount,
} from '@/lib/account-link';

/**
 * Server actions backing /setting/accounts.
 *
 * `connectProviderAction` redirects into Auth.js's OAuth flow. With the
 * user already signed in, the signIn callback in auth.ts treats the
 * callback as a *linking* request and writes the new Account row
 * against the current user — see auth.ts for the rationale and security
 * argument.
 *
 * `detachAccountAction` returns its result rather than throwing so the
 * client can render the "last sign-in method" message without an error
 * boundary.
 */

export type DetachResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'last_sign_in_method' | 'unknown' };


export async function connectProviderAction(provider: string): Promise<never> {
  await getSessionUserIdOrThrow();
  // `redirectTo` lands the user back on this page after the OAuth dance.
  // signIn() throws a redirect internally, so this function never returns.
  await signIn(provider, { redirectTo: '/setting/accounts' });
  // Unreachable, but TS doesn't know signIn throws.
  throw new Error('unreachable');
}


export async function detachAccountAction(accountId: string): Promise<DetachResult> {
  try {
    const userId = await getSessionUserIdOrThrow();
    await detachAccount(userId, accountId);
    revalidatePath('/setting/accounts');
    return { ok: true };
  } catch (err) {
    if (err instanceof DetachAccountError) {
      return { ok: false, error: err.code };
    }
    return { ok: false, error: 'unknown' };
  }
}
