// Hand-written canonical positive predicates (cmd_841 ruling_4, cmd_844
// round-based rewrite).
//
// cmd_844: a multistage approval_flow creates more than one approval_request
// row per submission (one per stage), all sharing the same created_at
// second (Postgres TIMESTAMPTZ(0)) -- so "the latest request" cannot be a
// single row selected by `orderBy: { created_at: 'desc' }, take: 1`
// (non-deterministic tie-break, confirmed by machine test --
// subtask_844a section_A_machine_verification). Instead every row that
// shares the latest `round_id` (the current "round" -- see
// prisma/schema.prisma's approval_request.round_id doc) is passed in as an
// array, and these predicates reason over the whole round's status set.
//
// Called from THREE sites to guarantee consistent behaviour between the
// screen (when the "(re)submit"/"Withdraw" button is shown) and the write
// path (whether a resubmission/withdrawal is actually allowed):
//   1. generators.py's _build_approval_edge_trigger_update_code
//      (code_generator/templates/service.ts.jinja2) — the ordinary PUT
//      route's update-time edge trigger guard.
//   2. generators.py's _build_submit_for_approval_action_code
//      (code_generator/templates/submit_for_approval.ts.jinja2) — the
//      generated explicit "(re)submit" server action, for entities that
//      cannot reach this state through an ordinary edit (edit: false).
//   3. components/_standard/ApprovalSection.tsx — the (re)submit/Withdraw
//      buttons' visibility checks on the view/edit page.
//
// Seven concept states a round's row-status set can be in (see
// subtask_844a section_D_test_design's matrix):
//   1. never submitted (no rows)
//   2. in flight (any pending)
//   3. partially approved, rest pending (any pending)
//   4. fully approved (every row approved)
//   5. non-terminal rejection (any rejected, no pending/approved/terminal)
//   6. terminal rejection (any terminal_rejected)
//   7. withdrawn (any withdrawn, no pending)
export type RoundRequestStatus = {
  status: string;
};

// A new approval_request round may be created only when the current round
// is:
//   (A) absent entirely (never submitted before), or
//   (B) fully approved (every row 'approved') -- NOT eligible, resubmission
//       after full approval is not silently allowed, or
//   (C) closed by a non-terminal rejection or a withdrawal, with no row
//       still 'pending' -- eligible. A round that reached partial approval
//       (some stages 'approved') before being closed this way is still
//       eligible: PD-1's final ruling (round_id scoping alone, approved
//       rows never rewritten) means resubmission always starts a brand new
//       round (new round_id, every stage back to pending) rather than
//       resuming from the closed stage -- so a leftover 'approved' row from
//       the just-closed round does not, by itself, block starting a new
//       one.
// A round with any row still 'terminal_rejected' never clears, regardless
// of what else is mixed in.
export function canSubmitForApproval(latestRoundRequests: RoundRequestStatus[]): boolean {
  if (latestRoundRequests.length === 0) return true;
  const statuses = latestRoundRequests.map((r) => r.status);
  if (statuses.some((s) => s === 'pending')) return false;
  if (statuses.every((s) => s === 'approved')) return false;
  if (statuses.some((s) => s === 'terminal_rejected')) return false;
  return true;
}

// The requestor may withdraw the current round only while it still has at
// least one 'pending' row -- a round with nothing left pending (fully
// approved, fully closed by rejection/withdrawal) has nothing left to
// withdraw.
export function canWithdrawApproval(latestRoundRequests: RoundRequestStatus[]): boolean {
  if (latestRoundRequests.length === 0) return false;
  return latestRoundRequests.some((r) => r.status === 'pending');
}
