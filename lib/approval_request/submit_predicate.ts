// Hand-written canonical positive predicate (cmd_841 ruling_4).
//
// Called from THREE sites to guarantee consistent behaviour between the
// screen (when the "(re)submit" button is shown) and the write path
// (whether a resubmission is actually allowed to create a new
// approval_request):
//   1. generators.py's _build_approval_edge_trigger_update_code
//      (code_generator/templates/service.ts.jinja2) — the ordinary PUT
//      route's update-time edge trigger guard.
//   2. generators.py's _build_submit_for_approval_action_code
//      (code_generator/templates/submit_for_approval.ts.jinja2) — the
//      generated explicit "(re)submit" server action, for entities that
//      cannot reach this state through an ordinary edit (edit: false).
//   3. components/_standard/ApprovalSection.tsx — the "(再)申請" button's
//      visibility check on the view/edit page.
//
// A new approval_request may be created only when the most recent one for
// this approvable is:
//   (A) absent entirely (never submitted before), or
//   (B) 'withdrawn' (the requestor pulled their own pending request), or
//   (C) 'rejected' AND this entity is not terminal (a non-terminal
//       rejection closes the flow but re-opens on resubmission).
// A terminal rejection is recorded as 'terminal_rejected' (a distinct
// status, see lib/approval_request/actions_core.ts's
// APPROVAL_REQUEST_STATUS_ORDER), never as 'rejected' -- the isTerminal
// parameter here is kept anyway to mirror pre-existing inline logic
// (generators.py's former _canCreate block) exactly, rather than relying
// on that status-naming invariant holding forever.
export function canSubmitForApproval(
  latestRequest: { status: string } | null | undefined,
  isTerminal: boolean,
): boolean {
  if (!latestRequest) return true;
  if (latestRequest.status === 'withdrawn') return true;
  if (latestRequest.status === 'rejected' && !isTerminal) return true;
  return false;
}
