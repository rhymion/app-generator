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
// Permission: uses the same Option B graceful-degradation contract as
// searchXxxOptions() (cmd_516) — a `user` read-permission denial returns an
// empty array with `permissionDenied: true` rather than throwing, so the
// picker can render a "suggestions unavailable" message instead of crashing.

import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow, getModelPermissions } from '@/lib/authz';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';

export interface MentionUserOption {
  id: string;
  name: string;
  email: string;
}

export async function searchMentionUserOptions(
  query: string,
): Promise<MentionUserOption[] & { permissionDenied?: boolean }> {
  const userId = await getSessionUserIdOrThrow();
  const { permissions } = await getModelPermissions('user', userId);
  if (!permissions.read) {
    return Object.assign([], { permissionDenied: true });
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

  return prisma.user.findMany({
    where: { ...orgFilter, ...nameFilter },
    select: { id: true, name: true, email: true },
    take: 20,
    orderBy: { name: 'asc' },
  });
}
