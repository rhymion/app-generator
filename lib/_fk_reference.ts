// Write-once (not regenerated). Shared by every generated service.ts
// add/update function: before a foreign key to an organization-scoped entity
// is written, the referenced row must live in an organization the actor
// belongs to AND the actor must be allowed to read it -- the same two
// conditions the referenced entity's own detail route applies. Any failure
// is reported as NOT_FOUND so a write cannot be used to probe which ids
// exist elsewhere.
import { AppError } from '@/lib/_errors';
import { canAccess } from '@/lib/authz';
import { getAssociatedOrganizations } from '@/lib/organization/associated_internal';

export type FkReference = {
  /** Prisma model name of the referenced entity. */
  model: string;
  /** The value being written; empty values are not references. */
  id: string | null | undefined;
  /** The value currently stored (update only); an unchanged reference is not re-checked. */
  previousId?: string | null;
  /** Loads the referenced row (whole row, so creator_id / assignee_id are available). */
  load: (id: string) => Promise<Record<string, unknown> | null>;
};

export async function assertFkReferencesUsable(actorId: string, refs: FkReference[]): Promise<void> {
  const changed = refs.filter((r) => r.id && r.id !== r.previousId);
  if (changed.length === 0) return;
  const orgIds = new Set((await getAssociatedOrganizations(actorId)).map((o) => o.id));
  for (const ref of changed) {
    const row = await ref.load(ref.id as string);
    if (!row) throw new AppError('NOT_FOUND', 'Not found');
    const rowOrgId = row.organization_id;
    // A null organization_id only exists when the target's organization column is optional.
    if (typeof rowOrgId === 'string' && !orgIds.has(rowOrgId)) {
      throw new AppError('NOT_FOUND', 'Not found');
    }
    const item = {
      creator_id: (row.creator_id as string | null | undefined) ?? null,
      assignee_id: (row.assignee_id as string | null | undefined) ?? null,
    };
    if (!(await canAccess(ref.model, 'read', actorId, item))) {
      throw new AppError('NOT_FOUND', 'Not found');
    }
  }
}
