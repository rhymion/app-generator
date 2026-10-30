'use server';

// Auto-generated — do not edit manually.
// Candidate search for the mention picker (cmd_522). Schema-global (not
// per-entity): emitted once whenever any schema definition has an
// x-mention: true field, alongside lib/mention/parser.ts.
//
// Scope: the record the mention is for, not the person typing. The caller names
// that record (`record.entity` + `record.id`, both client-supplied); the server
// re-reads it through the entity's own read gates (lib/mention/record_org.ts)
// and derives its organization itself. A record without an organization (no
// organization_id column, or an empty value) does not scope the candidates --
// an actor with no organization membership still gets candidates. A record with
// an organization offers only members of that organization, even to a caller
// who shares a different organization with them. A record the caller cannot
// read, or that does not exist, yields no candidates at all. No record (a form
// for a record that is not saved yet) does not scope either.
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
import { resolveMentionRecordOrganization } from '@/lib/mention/record_org';

export interface MentionUserOption {
  id: string;
  name: string;
  email: string;
}

/** The record a mention is being written for. Client-supplied: the server reads it again. */
export interface MentionRecordRef {
  entity: string;
  id: string;
}

export interface MentionSearchResult {
  options: MentionUserOption[];
  permissionDenied: boolean;
}

export async function searchMentionUserOptions(
  query: string,
  record?: MentionRecordRef | null,
): Promise<MentionSearchResult> {
  const userId = await getSessionUserIdOrThrow();
  const { permissions } = await getModelPermissions('user', userId);
  if (!permissions.read) {
    return { options: [], permissionDenied: true };
  }

  let orgFilter = {};
  if (record) {
    const resolved = await resolveMentionRecordOrganization(
      String(record.entity),
      String(record.id),
      userId,
    );
    // Unknown entity, missing record or a record the caller cannot read: nothing to suggest.
    if (!resolved) return { options: [], permissionDenied: false };
    if (resolved.organizationId) {
      orgFilter = { organizations: { some: { id: resolved.organizationId } } };
    }
  }

  const trimmed = query.trim();
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
