// Read scope for the dashboard aggregate.
//
// A widget may only count the rows its viewer could list on the entity's own page, and may only
// use a foreign-key label the viewer may read. This module resolves both from the same facts the
// entity getters apply (organization isolation, x-self-only, x-filter-values, Creator/Assignee
// read), taken from the generated `access-scope.ts`.
import { getModelPermissions } from '@/lib/authz';
import type { RichPermissions } from '@/lib/authz';
import { AppError } from '@/lib/_errors';
import { getAssociatedOrganizations } from '@/lib/organization/associated_internal';
import { trySelfOnlyAdminBypass } from '@/lib/self_only';
import { DASHBOARD_ACCESS_SCOPES } from './access-scope';

type Where = Record<string, unknown>;

async function buildAccessWhere(
  entityName: string,
  perms: RichPermissions,
  userId: string,
): Promise<Where[]> {
  const scope = DASHBOARD_ACCESS_SCOPES[entityName];
  // An entity without recorded scope facts is never readable here (fail closed).
  if (!scope) return [{ id: '__no_access__' }];

  const and: Where[] = [];
  if (scope.should_filter_by_org) {
    const orgIds = (await getAssociatedOrganizations(userId)).map((o) => o.id);
    and.push(
      scope.org_relationship_optional
        ? { OR: [{ organization_id: { in: orgIds } }, { organization_id: null }] }
        : { organization_id: { in: orgIds } },
    );
  }
  if (scope.is_self_only) {
    // creator_id is unconditional: no permission setting widens it.
    if (scope.self_only_admin_bypass && (await trySelfOnlyAdminBypass(entityName, userId))) {
      // Bypass granted (and audited): no creator restriction.
    } else {
      and.push({ creator_id: userId });
    }
  } else if (!perms.general.read) {
    const or: Where[] = [];
    if (perms.creator?.read) or.push({ creator_id: userId });
    if (scope.has_assignee_id && perms.assignee?.read) or.push({ assignee_id: userId });
    and.push(or.length === 0 ? { id: '__no_access__' } : { OR: or });
  }
  for (const [field, values] of Object.entries(scope.filter_values)) {
    and.push({ [field]: { in: values } });
  }
  return and;
}

/**
 * The WHERE clauses that restrict `entityName` to the rows `userId` may read. Throws
 * PERMISSION_DENIED when the user has no read permission on the entity at all.
 */
export async function requireDashboardReadScope(entityName: string, userId: string): Promise<Where[]> {
  const { permissions } = await getModelPermissions(entityName, userId);
  if (!permissions.read) {
    throw new AppError('PERMISSION_DENIED', `Access denied: ${entityName}.read`);
  }
  return buildAccessWhere(entityName, permissions, userId);
}

/** Like `requireDashboardReadScope`, but returns null instead of throwing when read is denied. */
export async function tryDashboardReadScope(entityName: string, userId: string): Promise<Where[] | null> {
  const { permissions } = await getModelPermissions(entityName, userId);
  if (!permissions.read) return null;
  return buildAccessWhere(entityName, permissions, userId);
}

/** AND the access clauses with an optional widget filter into one Prisma `where`. */
export function combineWhere(access: Where[], widget: Where | undefined): Where | undefined {
  const parts = widget ? [...access, widget] : access;
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { AND: parts };
}
