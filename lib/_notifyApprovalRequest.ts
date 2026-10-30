import type { PrismaClient } from '@/app/generated/prisma/client';
import { notify } from '@/lib/_notifier';

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Reads the organization of the record behind an approvable. The real
 * implementation (resolveApprovableOrganization in
 * lib/approval_request/resolve_target.ts) is generator-emitted and git-ignored,
 * so this hand-maintained module takes it as an argument from the generated
 * call sites instead of importing it: a static import cannot resolve on a
 * checkout that has not run generate-code (CI Unit Tests). See
 * docs/knowledge/troubleshooting.md §2.4.
 */
export type ResolveRecordOrganization = (
  tx: PrismaClient,
  entityType: string,
  approvableId: string,
) => Promise<{ scoped: false } | { scoped: true; organizationId: string | null } | null>;

/**
 * Organization a recipient must belong to: the organization of the record the
 * approval is about, never the acting user's. An explicit `orgId` wins;
 * otherwise the record is read through its approvable. A record without an
 * organization (the entity has no organization_id column, or the value is
 * empty) returns null, which means "do not scope": an organization-less
 * customer's approvers are notified exactly as before.
 */
async function resolveRecordOrgId(
  db: Tx,
  explicitOrgId: string | null,
  entityName: string | null | undefined,
  approvableId: string | null | undefined,
  resolveOrganization: ResolveRecordOrganization,
): Promise<string | null> {
  if (explicitOrgId) return explicitOrgId;
  if (!entityName || !approvableId) return null;
  const resolved = await resolveOrganization(db as PrismaClient, entityName, approvableId);
  return resolved?.scoped ? resolved.organizationId : null;
}

interface NotifyOptions {
  /** Generated resolveApprovableOrganization, injected by the caller (see ResolveRecordOrganization). */
  resolveOrganization: ResolveRecordOrganization;
  /**
   * Approvable-id this approval_request was created for. Used to look up the
   * owning entity row when org-scoping is requested.
   */
  approvableId?: string | null;
  /**
   * Entity-name shown in the notification title (e.g. "Leave Request"). If
   * omitted, falls back to the approval_flow's entity_name.
   */
  entityLabel?: string | null;
  /**
   * The record's own organization. Optional: when omitted, the notifier reads
   * the organization of the record behind the approvable itself. Either way,
   * approver-role members are limited to that organization when the record has
   * one, and are not limited at all when it has none.
   */
  orgId?: string | null;
  /**
   * User who created the entity. Skipped from the recipient list so the
   * creator doesn't get notified about their own request.
   */
  excludeUserId?: string | null;
  /**
   * The approvable's owning entity (e.g. 'leave_request') and that row's own
   * id. When both are provided, the notification links to that entity's
   * detail page (`/{targetEntityName}/view/{targetId}`) — the item the
   * approver actually needs to review — instead of the approval_request row,
   * which has no detail page of its own (cmd_479).
   */
  targetEntityName?: string | null;
  targetId?: string | null;
}

/**
 * Trigger #2 (notification design 2026-05-11): after an approval_request is
 * created, notify the users holding the approver role for its flow. When the
 * record has an organization, only members of that organization are notified;
 * a record without one does not narrow the recipients.
 *
 * Fire-and-forget — does not share a transaction with the caller. Safe to
 * call from inside an entity's afterCreate hook (it receives a `tx` so the
 * role/user lookup sees uncommitted rows; `notify()`'s own DB write is not
 * part of that transaction).
 */
export async function notifyApprovalRequestCreated(
  tx: unknown,
  approvalRequestId: string,
  options: NotifyOptions,
): Promise<void> {
  const db = tx as Tx;
  const req = await db.approval_request.findUnique({
    where: { id: approvalRequestId },
    select: {
      id: true,
      approvable_id: true,
      approval_flow: {
        select: { approver_role_id: true, entity_name: true },
      },
    },
  });
  if (!req?.approval_flow?.approver_role_id) return;

  const role = await db.role.findUnique({
    where: { id: req.approval_flow.approver_role_id },
    select: { users: { select: { id: true, organizations: { select: { id: true } } } } },
  });
  if (!role) return;

  const orgId = options.orgId ?? null;
  const excludeUserId = options.excludeUserId ?? null;
  const recordOrgId = await resolveRecordOrgId(
    db,
    orgId,
    req.approval_flow.entity_name,
    options.approvableId ?? req.approvable_id,
    options.resolveOrganization,
  );

  const entityLabel = options.entityLabel ?? req.approval_flow.entity_name ?? 'request';

  // cmd_479: link to the approvable's own detail page, not the
  // approval_request (which has no view page of its own — the old
  // `/approval_request/view/{id}` link 404'd). Omit href entirely when the
  // target isn't known so the bell still shows a (non-clickable) notice
  // rather than a broken link.
  const href =
    options.targetEntityName && options.targetId
      ? `/${options.targetEntityName}/view/${options.targetId}`
      : undefined;

  for (const u of role.users) {
    if (u.id === excludeUserId) continue;
    if (recordOrgId && !u.organizations.some((o) => o.id === recordOrgId)) continue;
    notify(u.id, 'approval_requested', {
      title: `New approval request: ${entityLabel}`,
      href,
      approvalRequestId: req.id,
      entityName: req.approval_flow.entity_name,
    });
  }
}

interface OrderReachedOptions {
  /** Generated resolveApprovableOrganization, injected by the caller (see ResolveRecordOrganization). */
  resolveOrganization: ResolveRecordOrganization;
  /** Entity-name shown in the notification title. Falls back to the flow's entity_name. */
  entityLabel?: string | null;
  /** Acting approver of the just-approved flow — skipped in case they also hold a follow-on flow's approver role. */
  excludeUserId?: string | null;
  /** Same link-target convention as notifyApprovalRequestCreated (cmd_479) — the approvable's own detail page. */
  targetEntityName?: string | null;
  targetId?: string | null;
}

/**
 * Trigger #4 (cmd_541): a preceded_by chain creates every flow's
 * approval_request up front (Trigger #2 notifies all of their approvers at
 * that point), but a follow-on flow isn't actually actionable until its
 * preceding flow(s) are approved — and until now, nothing told its
 * approvers when that moment arrived. They only found out by checking back
 * on their own.
 *
 * Called after a preceding flow's approval_request transitions to
 * 'approved' and lib/approval_request/order-check.ts's
 * findNewlyActionableFollowFlowIds() has determined which follow-on
 * flows (identified by approval_flow id) just became fully unblocked for
 * this approvable. Notifies every user holding each of those flows'
 * approver role — the same audience Trigger #2 already notified once, at
 * creation time, before they could act.
 */
export async function notifyApprovalOrderReached(
  tx: unknown,
  approvableId: string,
  flowIds: string[],
  options: OrderReachedOptions,
): Promise<void> {
  if (flowIds.length === 0) return;

  const db = tx as Tx;
  const requests = await db.approval_request.findMany({
    where: { approvable_id: approvableId, approval_flow_id: { in: flowIds } },
    select: {
      id: true,
      approval_flow: { select: { approver_role_id: true, entity_name: true } },
    },
  });

  const excludeUserId = options.excludeUserId ?? null;
  const href =
    options.targetEntityName && options.targetId
      ? `/${options.targetEntityName}/view/${options.targetId}`
      : undefined;

  for (const req of requests) {
    if (!req.approval_flow?.approver_role_id) continue;
    const role = await db.role.findUnique({
      where: { id: req.approval_flow.approver_role_id },
      select: { users: { select: { id: true, organizations: { select: { id: true } } } } },
    });
    if (!role) continue;

    const entityLabel = options.entityLabel ?? req.approval_flow.entity_name ?? 'request';
    const recordOrgId = await resolveRecordOrgId(
      db,
      null,
      req.approval_flow.entity_name,
      approvableId,
      options.resolveOrganization,
    );

    for (const u of role.users) {
      if (u.id === excludeUserId) continue;
      if (recordOrgId && !u.organizations.some((o) => o.id === recordOrgId)) continue;
      notify(u.id, 'approval_order_reached', {
        title: `Your approval is now needed: ${entityLabel}`,
        href,
        approvalRequestId: req.id,
        entityName: req.approval_flow.entity_name,
      });
    }
  }
}
