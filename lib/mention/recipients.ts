// Auto-generated — do not edit manually.
// Recipient scoping for @mention notifications. Not a Server Action module
// (no 'use server'): the record's organization is a trusted argument read by
// the calling action, never a client-supplied value.
//
// The scoping axis is the record the comment belongs to, not the commenter.
// A record without an organization (no organization_id column, or an empty
// value) does not scope its mentions: every mentioned user is notified. A
// record with an organization notifies only members of that organization, so
// a hand-written marker for a user outside it cannot deliver the comment text
// or a record link across the boundary — even to a user who shares another
// organization with the commenter.

import prisma from '@/lib/prisma';

/**
 * The subset of `candidateIds` allowed to be notified about a record of
 * `recordOrganizationId`, in the original order. No organization means no
 * scoping.
 */
export async function filterMentionRecipientsToRecordOrg(
  recordOrganizationId: string | null | undefined,
  candidateIds: string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  if (!recordOrganizationId) return candidateIds;
  const rows = await prisma.user.findMany({
    where: {
      id: { in: candidateIds },
      organizations: { some: { id: recordOrganizationId } },
    },
    select: { id: true },
  });
  const allowed = new Set(rows.map((row) => row.id));
  return candidateIds.filter((id) => allowed.has(id));
}
