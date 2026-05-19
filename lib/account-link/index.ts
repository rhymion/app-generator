/**
 * Account-link service: list, attach, detach OAuth Account rows for the
 * signed-in user.
 *
 * The Account table already supports multiple rows per user (PrismaAdapter
 * convention). What was missing was a UI/policy layer that lets users
 * inspect those rows and an admin-free way to add or remove them. This
 * module is the lib side of that; the route handlers live in
 * `app/[locale]/setting/accounts/`.
 *
 * Detach guard
 * ------------
 * A user must always retain *one* working way to sign in. `detachAccount`
 * refuses to delete the last Account row when the user also has no
 * credentials password set. The check is a single Prisma read inside the
 * same transaction as the delete so two parallel detach calls can't both
 * pass the guard and remove the last sign-in method.
 *
 * Attach
 * ------
 * Attaching a provider is not done in this module. The button on the
 * settings page kicks off Auth.js's normal `signIn(provider, …)` flow;
 * `auth.ts`'s signIn callback recognises the request as a link operation
 * because there is already an authenticated session for the same email,
 * and PrismaAdapter writes the new Account row via
 * `allowDangerousEmailAccountLinking`. See `auth.ts` for the rationale.
 */
import prisma from '@/lib/prisma';
import { siteConfig } from '@/lib/site-config';
import { recordAuditEvent } from '@/lib/audit-log';

export type LinkedAccount = {
  id: string;
  provider: string;
  providerAccountId: string;
};

// The Account model is part of Auth.js's adapter shape and isn't covered
// by the generated narrow Prisma types we use elsewhere. Cast through
// unknown for the same reason `lib/mfa/enrollment.ts` does it.
type AccountClient = {
  account: {
    findMany: (args: {
      where: { userId: string };
      select: { id: true; provider: true; providerAccountId: true };
      orderBy: { provider: 'asc' };
    }) => Promise<LinkedAccount[]>;
    findFirst: (args: {
      where: { id: string; userId: string };
      select: { id: true; provider: true };
    }) => Promise<{ id: string; provider: string } | null>;
    count: (args: { where: { userId: string } }) => Promise<number>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
  };
  user: {
    findUnique: (args: {
      where: { id: string };
      select: { password: true };
    }) => Promise<{ password: string | null } | null>;
  };
};

function db(): AccountClient {
  return prisma as unknown as AccountClient;
}


export async function listLinkedAccounts(userId: string): Promise<LinkedAccount[]> {
  return db().account.findMany({
    where: { userId },
    select: { id: true, provider: true, providerAccountId: true },
    orderBy: { provider: 'asc' },
  });
}


/**
 * OAuth providers from siteConfig that the user could still link — i.e.
 * configured for this deployment, OAuth (not credentials), and not
 * already represented in the user's Account rows.
 */
export async function availableProvidersForLinking(userId: string): Promise<string[]> {
  const configured = (siteConfig.auth?.providers ?? [])
    .filter((p): p is Exclude<typeof p, 'credentials'> => p !== 'credentials');
  const linked = await listLinkedAccounts(userId);
  const linkedSet = new Set(linked.map((a) => a.provider));
  return configured.filter((p) => !linkedSet.has(p));
}


/**
 * `true` if the user has at least one working sign-in method (a
 * credentials password, an OAuth Account, or both).
 *
 * Mirrors the invariant `detachAccount` enforces, exposed separately so the
 * UI can disable the detach button instead of letting the user click it
 * and read a thrown error.
 */
export async function hasAnotherSignInMethod(
  userId: string,
  excludingAccountId?: string,
): Promise<boolean> {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: { password: true },
  });
  if (user?.password) return true;
  const remaining = await db().account.count({ where: { userId } });
  // If the caller is asking "would removing accountId still leave a
  // method", the relevant count is everything minus the row about to go.
  const effective = excludingAccountId ? remaining - 1 : remaining;
  return effective > 0;
}


export class DetachAccountError extends Error {
  code: 'not_found' | 'last_sign_in_method';
  constructor(code: 'not_found' | 'last_sign_in_method', message: string) {
    super(message);
    this.code = code;
  }
}


/**
 * Remove an OAuth Account row from the user.
 *
 * Throws `DetachAccountError('not_found')` when the row doesn't exist
 * for this user (covers both "wrong id" and "belongs to someone else" —
 * we don't distinguish to avoid leaking ownership). Throws
 * `DetachAccountError('last_sign_in_method')` when removing the row
 * would leave the user with no way to sign back in.
 *
 * The ownership check, the guard, and the delete all run inside a
 * single transaction so two concurrent detach attempts can't both pass
 * the guard.
 */
export async function detachAccount(userId: string, accountId: string): Promise<void> {
  await (prisma as unknown as {
    $transaction: <T>(fn: (tx: AccountClient) => Promise<T>) => Promise<T>;
  }).$transaction(async (tx) => {
    const row = await tx.account.findFirst({
      where: { id: accountId, userId },
      select: { id: true, provider: true },
    });
    if (!row) {
      throw new DetachAccountError('not_found', 'Linked account not found');
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    if (!user?.password) {
      const remaining = await tx.account.count({ where: { userId } });
      if (remaining <= 1) {
        throw new DetachAccountError(
          'last_sign_in_method',
          'Cannot remove the last sign-in method',
        );
      }
    }

    await tx.account.delete({ where: { id: accountId } });

    await recordAuditEvent({
      action: 'auth:account.unlink',
      actor_user_id: userId,
      target_table: 'account',
      target_id: accountId,
      metadata: { provider: row.provider },
      tx,
    });
  });
}
