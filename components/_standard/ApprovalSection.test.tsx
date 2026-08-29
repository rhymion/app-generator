import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: (_ns: string) => (key: string) => key,
}));

const approveApprovalRequest = vi.fn();
const rejectApprovalRequest = vi.fn();
const withdrawApprovalRequest = vi.fn();
vi.mock('@/lib/approval_request/actions', () => ({
  approveApprovalRequest: (...args: unknown[]) => approveApprovalRequest(...args),
  rejectApprovalRequest: (...args: unknown[]) => rejectApprovalRequest(...args),
  withdrawApprovalRequest: (...args: unknown[]) => withdrawApprovalRequest(...args),
}));

import ApprovalSection from './ApprovalSection';

type Row = {
  id: string;
  approval_flow_id: string;
  round_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'terminal_rejected' | 'withdrawn';
  approval_flow?: {
    id: string;
    entity_name: string;
    approver_role_id?: string | null;
    preceded_by?: { id: string }[];
  } | null;
};

function makeSrc(requests: Row[], creatorId = 'requestor-1') {
  return { id: 'entity-1', approvable: { id: 'appr-1', creator_id: creatorId, approval_requests: requests } };
}

describe('ApprovalSection (cmd_844 round-based rendering)', () => {
  beforeEach(() => {
    approveApprovalRequest.mockReset();
    rejectApprovalRequest.mockReset();
    withdrawApprovalRequest.mockReset();
  });

  it('renders nothing when there are no requests and no submit action', () => {
    const { container } = render(<ApprovalSection src={makeSrc([])} />);
    expect(container).toBeEmptyDOMElement();
  });

  // cmd_844 (subtask_844b section_2): the flowIdToStatus Map used to build
  // precedingApproved must come from the CURRENT round only. This test
  // constructs the exact shape the CLUSTER-reorder machine test found
  // dangerous: round 1's stage-1 row is 'approved', round 2 (the current
  // round) has both stages 'pending'. If flowIdToStatus were built from the
  // full unscoped array, round 1's approved stage-1 could satisfy round 2's
  // stage-2 precedingApproved check even though round 2's OWN stage-1 is
  // still pending.
  it('never lets a past round\'s approved row unblock the current round\'s later stage', () => {
    const requests: Row[] = [
      // Round 1 (past): stage1 approved, stage2 rejected (non-terminal).
      { id: 'r1s1', approval_flow_id: 'flow-1', round_id: 'round-1', status: 'approved',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-2' } },
      { id: 'r1s2', approval_flow_id: 'flow-2', round_id: 'round-1', status: 'rejected',
        approval_flow: { id: 'flow-2', entity_name: 'e', approver_role_id: 'role-2', preceded_by: [{ id: 'flow-1' }] } },
      // Round 2 (current): both stages pending -- stage-1 not yet approved.
      { id: 'r2s1', approval_flow_id: 'flow-1', round_id: 'round-2', status: 'pending',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-1' } },
      { id: 'r2s2', approval_flow_id: 'flow-2', round_id: 'round-2', status: 'pending',
        approval_flow: { id: 'flow-2', entity_name: 'e', approver_role_id: 'role-2', preceded_by: [{ id: 'flow-1' }] } },
    ];

    render(
      <ApprovalSection
        src={makeSrc(requests)}
        currentUserRoleIds={['role-1', 'role-2']}
        currentUserId="approver-1"
      />,
    );

    // Only stage-1's approve/reject icons should render (stage-2 is
    // blocked -- its preceding flow is still pending in the current round,
    // even though a PAST round's stage-1 was approved).
    expect(screen.getAllByLabelText('Approve')).toHaveLength(1);
    expect(screen.getAllByLabelText('Reject')).toHaveLength(1);
  });

  it('shows the round-level Withdraw button only while the current round has a pending row', () => {
    const requests: Row[] = [
      { id: 'r1', approval_flow_id: 'flow-1', round_id: 'round-1', status: 'approved',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-1' } },
      { id: 'r2', approval_flow_id: 'flow-2', round_id: 'round-1', status: 'pending',
        approval_flow: { id: 'flow-2', entity_name: 'e', approver_role_id: 'role-2', preceded_by: [{ id: 'flow-1' }] } },
    ];

    render(<ApprovalSection src={makeSrc(requests)} currentUserId="requestor-1" hasOnWithdrawn />);

    expect(screen.getByLabelText('Withdraw')).toBeInTheDocument();
  });

  it('hides the Withdraw button once the current round is fully approved', () => {
    const requests: Row[] = [
      { id: 'r1', approval_flow_id: 'flow-1', round_id: 'round-1', status: 'approved',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-1' } },
      { id: 'r2', approval_flow_id: 'flow-2', round_id: 'round-1', status: 'approved',
        approval_flow: { id: 'flow-2', entity_name: 'e', approver_role_id: 'role-2', preceded_by: [{ id: 'flow-1' }] } },
    ];

    render(<ApprovalSection src={makeSrc(requests)} currentUserId="requestor-1" hasOnWithdrawn />);

    expect(screen.queryByLabelText('Withdraw')).not.toBeInTheDocument();
  });

  it('hides the Withdraw button for a user who is not the requestor', () => {
    const requests: Row[] = [
      { id: 'r1', approval_flow_id: 'flow-1', round_id: 'round-1', status: 'pending',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-1' } },
    ];

    render(<ApprovalSection src={makeSrc(requests, 'requestor-1')} currentUserId="someone-else" hasOnWithdrawn />);

    expect(screen.queryByLabelText('Withdraw')).not.toBeInTheDocument();
  });

  // cmd_865: entities that never declare x-approval.on_withdrawn have no
  // resubmission-safe path back out of 'withdrawn' (see subtask_865a's
  // ko_withdraw_lockout_design) -- the button must not render even when
  // every other condition (matching requestor, a pending row) is met.
  it('hides the Withdraw button when the entity does not declare on_withdrawn, even with a pending row and matching requestor', () => {
    const requests: Row[] = [
      { id: 'r1', approval_flow_id: 'flow-1', round_id: 'round-1', status: 'pending',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-1' } },
    ];

    render(<ApprovalSection src={makeSrc(requests)} currentUserId="requestor-1" />);

    expect(screen.queryByLabelText('Withdraw')).not.toBeInTheDocument();
  });

  it('withdraw button calls withdrawApprovalRequest with the approvable id, not a row id', () => {
    const requests: Row[] = [
      { id: 'r1', approval_flow_id: 'flow-1', round_id: 'round-1', status: 'pending',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-1' } },
    ];

    render(<ApprovalSection src={makeSrc(requests)} currentUserId="requestor-1" hasOnWithdrawn />);

    fireEvent.click(screen.getByLabelText('Withdraw'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'withdraw' }));

    expect(withdrawApprovalRequest).toHaveBeenCalledWith('appr-1', undefined);
  });

  // cmd_844: a round that reached partial approval before closing (via a
  // non-terminal reject or a withdrawal) is still eligible for
  // resubmission -- the (re)submit button must render even though one row
  // in the closed round is 'approved'.
  it('shows the (re)submit button when the current round is closed but had a partial approval', () => {
    const requests: Row[] = [
      { id: 'r1', approval_flow_id: 'flow-1', round_id: 'round-1', status: 'approved',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-1' } },
      { id: 'r2', approval_flow_id: 'flow-2', round_id: 'round-1', status: 'withdrawn',
        approval_flow: { id: 'flow-2', entity_name: 'e', approver_role_id: 'role-2', preceded_by: [{ id: 'flow-1' }] } },
    ];

    render(
      <ApprovalSection
        src={makeSrc(requests)}
        currentUserId="requestor-1"
        onSubmitForApproval={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByLabelText('submit')).toBeInTheDocument();
  });

  it('groups past rounds under a collapsible history section, separate from the current round table', () => {
    const requests: Row[] = [
      { id: 'r1', approval_flow_id: 'flow-1', round_id: 'round-1', status: 'withdrawn',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-1' } },
      { id: 'r2', approval_flow_id: 'flow-1', round_id: 'round-2', status: 'pending',
        approval_flow: { id: 'flow-1', entity_name: 'e', approver_role_id: 'role-1' } },
    ];

    render(<ApprovalSection src={makeSrc(requests)} currentUserId="requestor-1" />);

    // Past round is collapsed by default.
    expect(screen.queryByText('withdrawn')).not.toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();

    fireEvent.click(screen.getByText('pastSubmissions'));
    expect(screen.getByText('withdrawn')).toBeInTheDocument();
  });
});
