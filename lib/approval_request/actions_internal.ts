// Plain internal module (no server-function directive): the wiring of
// actions_core.ts to the generator-emitted collaborators, plus helpers that
// are only safe to call after the caller has been checked. Nothing here is
// registered as a callable endpoint.
//
// actions.ts (the directive module) re-exposes only the entry points that
// derive the acting user from the session. Do not add a directive here and
// do not import this module from a Client Component.

import { dispatchOnApproved } from '@/lib/approval_request/on_approved_dispatch';
import { isTerminalReject, dispatchOnRejected } from '@/lib/approval_request/on_rejected_dispatch';
import { dispatchOnWithdrawn, hasOnWithdrawn } from '@/lib/approval_request/on_withdrawn_dispatch';
import { resolveApprovableTarget, resolveApprovableModel, resolveApprovableOrganization } from '@/lib/approval_request/resolve_target';
import { createApprovalActions } from '@/lib/approval_request/actions_core';
// cmd_923b: pre-action validation dispatchers -- see actions_core.ts's
// ApprovalActionDeps doc for why these are injected the same way as the
// on_approved/on_rejected/on_withdrawn dispatchers above.
import { dispatchBeforeApprove } from '@/lib/approval_request/on_before_approve_dispatch';
import { dispatchBeforeReject } from '@/lib/approval_request/on_before_reject_dispatch';
import { dispatchBeforeWithdraw } from '@/lib/approval_request/on_before_withdraw_dispatch';

// This is the only place in the approval_request flow that statically
// imports the generator-emitted collaborators (code_generator/generate.py,
// PR #203) — all business logic lives in actions_core.ts, which takes them
// as injected deps instead, so actions.test.ts can exercise that logic
// without generate-code having run. See docs/knowledge/troubleshooting.md
// §2.4.
export const approvalActions = createApprovalActions({
  resolveApprovableTarget,
  resolveApprovableModel,
  resolveApprovableOrganization,
  dispatchOnApproved,
  dispatchOnRejected,
  isTerminalReject,
  dispatchOnWithdrawn,
  hasOnWithdrawn,
  dispatchBeforeApprove,
  dispatchBeforeReject,
  dispatchBeforeWithdraw,
});

/**
 * Looks up the requestor and target of an approval_request by id with no
 * session or permission check of its own. Call it only from code that has
 * already authorized the caller for this request (the approve / reject
 * paths and routes).
 */
export async function getApprovalRequestRecipient(id: string): Promise<{
  recipientId: string | null;
  entityName: string | null;
  targetId: string | null;
  href: string | undefined;
}> {
  return approvalActions.getApprovalRequestRecipient(id);
}
