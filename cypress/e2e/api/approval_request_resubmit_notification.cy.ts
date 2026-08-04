import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

// cmd_539: re-submitting a rejected approval_request never notified the
// approver. Root cause: resubmitApprovalRequest() (both the server action
// in lib/approval_request/actions_core.ts and the REST route
// app/api/approval_request/[id]/resubmit/route.ts) transitions status back
// to 'pending' by re-using the existing approval_request row, so
// notifyApprovalRequestCreated() — only ever wired into the *creation* path
// (service_after_create_stub.ts.jinja2 / split_action_route.ts.jinja2) —
// never ran a second time for a resubmission.
//
// This proves the fix at the delivery layer: a real row lands in the
// `notification` table and is read back through the same
// GET /api/notifications endpoint NotificationBell.tsx polls — not merely
// that some notify() function was called.
describe('approval_request resubmit notification (cmd_539)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    Cypress.session.clearAllSavedSessions();
  });

  it('notifies the approver-role holder when a rejected request is re-submitted', () => {
    cy.task<{ approvalRequestId: string; approverEmail: string }>(
      'db:setupApprovalNotificationFixture',
    ).then((fixture) => {
      cy.login(fixture.approverEmail, TEST_CREDENTIALS.password);

      // Reject (temporary — 'user' is not configured for terminal reject,
      // so this lands on 'rejected', not 'terminal_rejected').
      cy.request({
        method: 'POST',
        url: `/api/approval_request/${fixture.approvalRequestId}/reject`,
        body: { message: 'needs more detail' },
      })
        .its('status')
        .should('eq', 200);

      // Baseline: this fixture's approval_request was seeded directly via
      // Prisma (not through afterCreate), so no 'approval_requested'
      // notification exists yet for it.
      cy.request('/api/notifications').then((res) => {
        const before = (res.body.items as Array<{ type: string; payload: { approvalRequestId?: string } }>).filter(
          (n) => n.type === 'approval_requested' && n.payload?.approvalRequestId === fixture.approvalRequestId,
        );
        expect(before, 'no approval_requested notification before resubmit').to.have.length(0);
      });

      // Re-submit as the requester. The REST resubmit route authenticates
      // via X-API-Key (authenticateApiKey), unlike approve/reject which use
      // session auth (requireSession) — an existing asymmetry between the
      // two implementations, not something this test needs to change.
      cy.request({
        method: 'POST',
        url: `/api/approval_request/${fixture.approvalRequestId}/resubmit`,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {},
      })
        .its('status')
        .should('eq', 200);

      // The approver must now have a real, DB-persisted notification,
      // readable through the exact endpoint the bell polls.
      cy.request('/api/notifications').then((res) => {
        const after = (res.body.items as Array<{ type: string; payload: { approvalRequestId?: string; title?: string } }>).filter(
          (n) => n.type === 'approval_requested' && n.payload?.approvalRequestId === fixture.approvalRequestId,
        );
        expect(after, 'approver receives a real notification row after resubmit').to.have.length(1);
        expect(after[0].payload.title).to.contain('New approval request');
      });
    });
  });
});
