import { describe, it, expect } from 'vitest';
import { canSubmitForApproval } from './submit_predicate';

// cmd_841 ruling_4: this pins the actual absent/withdrawn/non-terminal-
// rejected logic behind canSubmitForApproval(), the single predicate now
// shared by generators.py's update-edge-trigger guard, the generated
// submit_for_approval server action, and ApprovalSection.tsx's submit
// button visibility check. code_generator/tests/test_approval_edge_trigger.py
// pins the generated call site (that it calls this function with the right
// arguments); this file pins what the function itself decides.
describe('canSubmitForApproval', () => {
  it('allows submission when no approval_request exists yet', () => {
    expect(canSubmitForApproval(null, false)).toBe(true);
    expect(canSubmitForApproval(undefined, false)).toBe(true);
  });

  it('allows submission after a withdrawal', () => {
    expect(canSubmitForApproval({ status: 'withdrawn' }, false)).toBe(true);
    expect(canSubmitForApproval({ status: 'withdrawn' }, true)).toBe(true);
  });

  it('allows submission after a non-terminal rejection', () => {
    expect(canSubmitForApproval({ status: 'rejected' }, false)).toBe(true);
  });

  it('blocks submission after a terminal rejection', () => {
    expect(canSubmitForApproval({ status: 'rejected' }, true)).toBe(false);
  });

  it('blocks submission while a request is still pending', () => {
    expect(canSubmitForApproval({ status: 'pending' }, false)).toBe(false);
    expect(canSubmitForApproval({ status: 'pending' }, true)).toBe(false);
  });

  it('blocks submission once a request has been approved', () => {
    expect(canSubmitForApproval({ status: 'approved' }, false)).toBe(false);
    expect(canSubmitForApproval({ status: 'approved' }, true)).toBe(false);
  });

  it('blocks submission for a terminal_rejected status', () => {
    expect(canSubmitForApproval({ status: 'terminal_rejected' }, true)).toBe(false);
    expect(canSubmitForApproval({ status: 'terminal_rejected' }, false)).toBe(false);
  });
});
