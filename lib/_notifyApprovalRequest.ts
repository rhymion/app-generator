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

  for (const u of role.users) {
    if (u.id === excludeUserId) continue;
    if (orgId && !u.organizations.some((o) => o.id === orgId)) continue;
    notify(u.id, 'approval_requested', {
      title: `New approval request: ${entityLabel}`,
      href: `/approval_request/view/${req.id}`,
      approvalRequestId: req.id,
      entityName: req.approval_flow.entity_name,
    });
  }
}
