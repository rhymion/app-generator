// Write-once (not regenerated). The in-memory form of the read-scope filter
// every generated list and detail read applies (build<Entity>AccessWhere in
// getters.ts): a row is reachable by an actor when
//   1. its organization is one the actor belongs to (a row without an
//      organization is reachable, as in the list filter),
//   2. for an x-self-only entity, the actor created it (or holds the audited
//      admin bypass) -- no permission setting widens this, and
//   3. otherwise the actor holds read permission on it: a general grant, or a
//      Creator / Assignee grant on a row the actor created / is assigned to.
// x-filter-values is deliberately not part of this decision.
//
// Used wherever a write must decide whether a row it points at "exists" for
// the actor (see _fk_reference.ts): an unreachable row is reported exactly
// like a missing one, so the answer never says which of the two it was.
import { canAccessEntity, canAccessRecord } from '@/lib/authz';
import { trySelfOnlyAdminBypass } from '@/lib/self_only';

export type ReachabilityTarget = {
  /** Prisma model name of the entity the row belongs to. */
  model: string;
  /** True when the entity is x-self-only. */
  selfOnly?: boolean;
};

export async function isRowReachable(
  actorId: string,
  organizationIds: ReadonlySet<string>,
  target: ReachabilityTarget,
  row: Record<string, unknown>,
): Promise<boolean> {
  const rowOrgId = row.organization_id;
  // A null organization_id only exists when the target's organization column is optional.
  if (typeof rowOrgId === 'string' && !organizationIds.has(rowOrgId)) return false;

  if (target.selfOnly) {
    if (!(await canAccessEntity(target.model, 'read', actorId))) return false;
    if (row.creator_id === actorId) return true;
    return trySelfOnlyAdminBypass(target.model, actorId);
  }

  return canAccessRecord(
    target.model,
    'read',
    {
      creator_id: (row.creator_id as string | null | undefined) ?? null,
      assignee_id: (row.assignee_id as string | null | undefined) ?? null,
    },
    actorId,
  );
}
