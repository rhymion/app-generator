import type { PrismaClient } from '@/app/generated/prisma/client';
import { notify } from '@/lib/_notifier';

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

interface NotifyOptions {
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
   * When the entity has organization-scope, pass `{ orgId }` so the notifier
   * filters approver-role members to that organization (per the notification
   * design: "if the item has organization information").
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
 * created, notify every user holding the approver role for its flow. Optional
 * org-scope filter applied when `orgId` is provided.
 *
 * Fire-and-forget — does not share a transaction with the caller. Safe to
 * call from inside an entity's afterCreate hook (it receives a `tx` so the
 * role/user lookup sees uncommitted rows; the `notify()` itself is
 * in-memory and not transactional).
 */
export async function notifyApprovalRequestCreated(
  tx: unknown,
  approvalRequestId: string,
  options: NotifyOptions = {},
): Promise<void> {
  const db = tx as Tx;
  const req = await db.approval_request.findUnique({
    where: { id: approvalRequestId },
    select: {
      id: true,
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
    if (orgId && !u.organizations.some((o) => o.id === orgId)) continue;
    notify(u.id, 'approval_requested', {
      title: `New approval request: ${entityLabel}`,
      href,
      approvalRequestId: req.id,
      entityName: req.approval_flow.entity_name,
    });
  }
}

interface OrderReachedOptions {
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
  options: OrderReachedOptions = {},
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
      select: { users: { select: { id: true } } },
    });
    if (!role) continue;

    const entityLabel = options.entityLabel ?? req.approval_flow.entity_name ?? 'request';

    for (const u of role.users) {
      if (u.id === excludeUserId) continue;
      notify(u.id, 'approval_order_reached', {
        title: `Your approval is now needed: ${entityLabel}`,
        href,
        approvalRequestId: req.id,
        entityName: req.approval_flow.entity_name,
      });
    }
  }
}
