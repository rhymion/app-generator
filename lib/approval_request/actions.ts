'use server';

import { approvalActions } from '@/lib/approval_request/actions_internal';

// Only entry points that derive the acting user from the session belong in
// this module: every export of a module-level server-function file is
// registered as an independently callable endpoint. The recipient lookup
// (getApprovalRequestRecipient) is a helper for the approve/reject paths
// that have already checked the caller, so it lives in actions_internal.ts.

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

// cmd_844: takes the approvable id, not a specific approval_request id --
// withdrawal is now round-scoped (see actions_core.ts's
// withdrawApprovalRequest doc).
export async function withdrawApprovalRequest(approvableId: string, message?: string): Promise<void> {
  return approvalActions.withdrawApprovalRequest(approvableId, message);
}

