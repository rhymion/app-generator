import prisma from '@/lib/prisma';

export type ApprovableOrganization =
  | { scoped: false }
  | { scoped: true; organizationId: string | null };

export type ResolveApprovableOrganization = (
  tx: typeof prisma,
  entityType: string,
  approvableId: string,
) => Promise<ApprovableOrganization | null>;

/**
 * Whether `userId` may act on the record behind approval request
 * `approvalRequestId`, as far as organization scoping goes. The approver role
 * (checked separately) says who may approve; this says whose records they may
 * approve: a user must belong to the organization of the target record.
 *
 * - Entity without an organization_id column: not organization-scoped, allowed.
 * - Record with a NULL organization (optional organization relationship):
 *   not tied to any organization, allowed, same as the read scope.
 * - Otherwise the user must be a member of the record's organization.
 * - Entity that is not an approvable entity of the app: not scoped, allowed
 *   (the resolver reports it as `scoped: false`).
 * - Unknown request, or a missing record of a known entity: refused (fail closed).
 *
 * Shared by the REST approve/reject routes and the Server Action path
 * (actions_core.ts) so both apply the same rule.
 */
export async function isApproverInTargetOrganization(
  userId: string,
  approvalRequestId: string,
  resolveApprovableOrganization: ResolveApprovableOrganization,
): Promise<boolean> {
  const req = await prisma.approval_request.findUnique({
    where: { id: approvalRequestId },
    select: { approvable_id: true, approval_flow: { select: { entity_name: true } } },
  });
  if (!req?.approval_flow) return false;
  const target = await resolveApprovableOrganization(prisma, req.approval_flow.entity_name, req.approvable_id);
  if (!target) return false;
  if (!target.scoped || target.organizationId === null) return true;
  const membership = await prisma.organization.findFirst({
    where: { id: target.organizationId, users: { some: { id: userId } } },
    select: { id: true },
  });
  return membership !== null;
}
