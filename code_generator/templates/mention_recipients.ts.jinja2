// Auto-generated — do not edit manually.
// Recipient scoping for @mention notifications. Not a Server Action module
// (no 'use server'): the actor id is a trusted argument from the calling
// action, never a client-supplied value.
//
// Same org scope as the mention picker (lib/mention/search.ts): a mentioned
// user receives a notification only when they share an organization with the
// actor. An actor with no organization membership notifies nobody, so a
// hand-written marker for a user in another organization (or for any user at
// all) cannot deliver the comment text or a record link across the boundary.

import prisma from '@/lib/prisma';

/** The subset of `candidateIds` that shares an organization with `actorId`, in the original order. */
export async function filterMentionRecipientsToActorOrgs(
  actorId: string,
  candidateIds: string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: {
      id: { in: candidateIds },
      organizations: { some: { users: { some: { id: actorId } } } },
    },
    select: { id: true },
  });
  const allowed = new Set(rows.map((row) => row.id));
  return candidateIds.filter((id) => allowed.has(id));
}
