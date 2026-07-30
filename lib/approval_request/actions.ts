'use server';

import { dispatchOnApproved } from '@/lib/approval_request/on_approved_dispatch';
import { isTerminalReject, dispatchOnRejected } from '@/lib/approval_request/on_rejected_dispatch';
import { resolveApprovableTarget } from '@/lib/approval_request/resolve_target';
import { createApprovalActions } from '@/lib/approval_request/actions_core';

// This is the only place in the approval_request flow that statically
// imports the generator-emitted collaborators (code_generator/generate.py,
// PR #203) — all business logic lives in actions_core.ts, which takes them
// as injected deps instead, so actions.test.ts can exercise that logic
// without generate-code having run. See docs/knowledge/troubleshooting.md
// §2.4.
const approvalActions = createApprovalActions({
  resolveApprovableTarget,
  dispatchOnApproved,
  dispatchOnRejected,
  isTerminalReject,
});

export async function getApprovalRequestRecipient(id: string): Promise<{
  recipientId: string | null;
  entityName: string | null;
  href: string | undefined;
}> {
  return approvalActions.getApprovalRequestRecipient(id);
}

export async function approveApprovalRequest(id: string, message?: string): Promise<void> {
  return approvalActions.approveApprovalRequest(id, message);
}

export async function rejectApprovalRequest(
  id: string,
  message?: string,
  options?: { reason?: string; reasonKind?: number },
): Promise<void> {
  return approvalActions.rejectApprovalRequest(id, message, options);
}

export async function resubmitApprovalRequest(id: string, message?: string): Promise<void> {
  return approvalActions.resubmitApprovalRequest(id, message);
}
