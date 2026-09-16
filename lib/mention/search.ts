'use server';

// Auto-generated — do not edit manually.
// Candidate search for the mention picker (cmd_522). Schema-global (not
// per-entity): emitted once whenever any schema definition has an
// x-mention: true field, alongside lib/mention/parser.ts.
//
// Org scope: `user` has no organization_id FK (unlike the entities covered by
// should_filter_by_org / lookup_entity_filter_by_org — cmd_521's axis), so
// candidates are restricted via the M2M organization membership relation
// (getAssociatedOrganizations) instead. An actor with no organization
// membership gets an empty candidate list — they may still write comments,
// they just cannot mention anyone (org-isolation policy).
//
// Permission: intends the same Option B graceful-degradation contract as
// searchXxxOptions() (cmd_516) — a `user` read-permission denial should
// return an empty list with permissionDenied: true rather than throwing, so
// the picker can render a "suggestions unavailable" message instead of
// crashing. The return type is a plain `{ options, permissionDenied }`
// object, NOT `MentionUserOption[] & { permissionDenied?: boolean }`: this
// crosses the server/client boundary as a Server Action return value, and
// Next's RSC "flight" serialization (like JSON.stringify) only preserves an
// array's indexed elements — an ad-hoc property tacked onto a plain array
// via Object.assign is silently dropped in transit, so the client never
// sees the flag even though the server set it correctly. This is why the
// naive array-with-extra-property version of this contract (cmd_538 found
// it here; searchXxxOptions() in getters.ts uses the identical pattern and
// is presumed to share the bug, but fixing that is out of this template's
// scope — see docs/knowledge/mention-system.md's cmd_538 section) can pass
// a unit test that calls searchUsers as a plain in-process function (no
// serialization boundary) while still being broken end-to-end in a real
// browser.

import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow, getModelPermissions } from '@/lib/authz';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';

export interface MentionUserOption {
  id: string;
  name: string;
  email: string;
}

export interface MentionSearchResult {
  options: MentionUserOption[];
  permissionDenied: boolean;
}

export async function searchMentionUserOptions(
  query: string,
): Promise<MentionSearchResult> {
  const userId = await getSessionUserIdOrThrow();
  const { permissions } = await getModelPermissions('user', userId);
  if (!permissions.read) {
    return { options: [], permissionDenied: true };
  }

  const actorOrgs = await getAssociatedOrganizations(userId);
  const actorOrgIds = actorOrgs.map((organization) => organization.id);

  const trimmed = query.trim();
  const orgFilter = actorOrgIds.length > 0
    ? { organizations: { some: { id: { in: actorOrgIds } } } }
    : { id: '__no_org_membership__' }; // no org membership → no candidates (safe empty)
  const nameFilter = trimmed
    ? { name: { contains: trimmed, mode: 'insensitive' as const } }
    : {};

  const options = await prisma.user.findMany({
    where: { ...orgFilter, ...nameFilter },
    select: { id: true, name: true, email: true },
    take: 20,
    orderBy: { name: 'asc' },
  });
  return { options, permissionDenied: false };
}
