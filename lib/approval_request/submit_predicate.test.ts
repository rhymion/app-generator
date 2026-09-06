import { describe, it, expect } from 'vitest';
import { canSubmitForApproval, canWithdrawApproval } from './submit_predicate';

// cmd_844: pins the round-based (array-of-rows) predicates that replaced
// the single-row cmd_841 ruling_4 predicate -- see submit_predicate.ts's
// module doc for why a single "latest row" is no longer well-defined once
// a multistage approval_flow can create more than one row per round.
// code_generator/tests/test_approval_edge_trigger.py pins the generated
// call site (that it calls these functions with the right arguments and
// query shape); this file pins what the functions themselves decide,
// across the seven concept states a round can be in.
describe('canSubmitForApproval', () => {
  it('1. never submitted: no rows -> allowed', () => {
    expect(canSubmitForApproval([])).toBe(true);
  });

  it('2. in flight: all stages pending -> blocked', () => {
    expect(canSubmitForApproval([{ status: 'pending' }, { status: 'pending' }])).toBe(false);
  });

  it('3. partially approved, rest pending -> blocked', () => {
    expect(canSubmitForApproval([{ status: 'approved' }, { status: 'pending' }])).toBe(false);
  });

  it('4. fully approved -> blocked', () => {
    expect(canSubmitForApproval([{ status: 'approved' }, { status: 'approved' }])).toBe(false);
  });

  it('5. non-terminal rejection -> allowed', () => {
    expect(canSubmitForApproval([{ status: 'approved' }, { status: 'rejected' }])).toBe(true);
    expect(canSubmitForApproval([{ status: 'rejected' }])).toBe(true);
  });

  it('6. terminal rejection -> blocked', () => {
    expect(canSubmitForApproval([{ status: 'approved' }, { status: 'terminal_rejected' }])).toBe(false);
    expect(canSubmitForApproval([{ status: 'terminal_rejected' }])).toBe(false);
  });

  it('7. withdrawn -> allowed (resubmission starts a new round from stage one)', () => {
    expect(canSubmitForApproval([{ status: 'approved' }, { status: 'withdrawn' }])).toBe(true);
    expect(canSubmitForApproval([{ status: 'withdrawn' }])).toBe(true);
  });

  // cmd_963: 8th state, additive only -- states 1-7 above are pinned
  // unchanged by this same test file; split_invalidated never appeared in
  // any of their inputs, so none of those assertions exercise the new
  // branch. This state can only ever arise from a split (see
  // split_action_route.ts.jinja2), never as a fresh input on its own.
  it('8. split-invalidated: parent split into children -> blocked, permanently (never clears)', () => {
    expect(canSubmitForApproval([{ status: 'split_invalidated' }])).toBe(false);
    expect(canSubmitForApproval([{ status: 'approved' }, { status: 'split_invalidated' }])).toBe(false);
  });
});

describe('canWithdrawApproval', () => {
  it('1. never submitted: no rows -> cannot withdraw', () => {
    expect(canWithdrawApproval([])).toBe(false);
  });

  it('2. in flight: all stages pending -> can withdraw', () => {
    expect(canWithdrawApproval([{ status: 'pending' }, { status: 'pending' }])).toBe(true);
  });

  it('3. partially approved, rest pending -> can withdraw', () => {
    expect(canWithdrawApproval([{ status: 'approved' }, { status: 'pending' }])).toBe(true);
  });

  it('4. fully approved -> cannot withdraw (nothing pending left)', () => {
    expect(canWithdrawApproval([{ status: 'approved' }, { status: 'approved' }])).toBe(false);
  });

  it('5. non-terminal rejection -> cannot withdraw', () => {
    expect(canWithdrawApproval([{ status: 'approved' }, { status: 'rejected' }])).toBe(false);
  });

  it('6. terminal rejection -> cannot withdraw', () => {
    expect(canWithdrawApproval([{ status: 'approved' }, { status: 'terminal_rejected' }])).toBe(false);
  });

  it('7. withdrawn -> cannot withdraw again', () => {
    expect(canWithdrawApproval([{ status: 'approved' }, { status: 'withdrawn' }])).toBe(false);
  });
});
