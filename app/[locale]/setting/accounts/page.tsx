import { getSessionUserIdOrThrow } from '@/lib/authz';
import {
  availableProvidersForLinking,
  listLinkedAccounts,
} from '@/lib/account-link';
import prisma from '@/lib/prisma';

import AccountsClient from './accounts-client';

// Server component: pulls the user's Account rows and the list of OAuth
// providers still available to link, plus the booleans the client needs
// to decide whether the "Detach" button is enabled (we don't want to let
// the user click it and read a thrown error when removing the row would
// strand them).
export default async function AccountsSettingsPage() {
  const userId = await getSessionUserIdOrThrow();

  const [linked, available, user] = await Promise.all([
    listLinkedAccounts(userId),
    availableProvidersForLinking(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { password: true } }),
  ]);

  // For each linked row, compute whether removing *that one* would still
  // leave a working sign-in method. Cheaper to derive client-side from
  // (hasPassword, totalCount) than another DB round trip per row.
  const hasPassword = Boolean(user?.password);
  const accounts = linked.map((a) => ({
    ...a,
    canDetach: hasPassword || linked.length > 1,
  }));

  return (
    <AccountsClient
      accounts={accounts}
      availableProviders={available}
      hasPassword={hasPassword}
    />
  );
}
