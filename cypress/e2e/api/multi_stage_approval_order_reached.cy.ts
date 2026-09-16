import { TEST_CREDENTIALS } from '../../support/test-credentials';

// cmd_541: in a preceded_by chain, every flow's approval_request is created
// up front (Trigger #2, notifyApprovalRequestCreated) when the approvable
// entity is created — including flow2's, even though flow2 isn't
// actionable yet because flow1 hasn't been approved. Approving flow1 was
// silent: flow2's approver never learned their turn had arrived, short of
// polling the item themselves. This proves the fix at the delivery layer —
// a real row lands in the `notification` table and is read back through
// the same GET /api/notifications endpoint NotificationBell.tsx polls —
// not merely that some notify() function was called.
describe('multi-stage approval order-reached notification (cmd_541)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    Cypress.session.clearAllSavedSessions();
  });

  it('notifies the stage-2 approver only once flow1 is approved, and only once', () => {
    cy.task<{
      approvalRequest1Id: string;
      approver1Email: string;
      approver2Email: string;
    }>('db:setupMultiStageApprovalFixture').then((fixture) => {
      // Baseline (as stage-2 approver): the only notification they hold is
      // the creation-time 'approval_requested' one — nothing else yet, since
      // flow1 hasn't been approved.
      cy.login(fixture.approver2Email, TEST_CREDENTIALS.password);
      cy.request('/api/notifications').then((res) => {
        const items = res.body.items as Array<{ type: string }>;
        expect(items.filter((n) => n.type === 'approval_requested'), 'creation-time notification present').to.have.length(1);
        expect(items.filter((n) => n.type === 'approval_order_reached'), 'no order-reached notification before flow1 is approved').to.have.length(0);
      });

      // Approve flow1 as the stage-1 approver.
      cy.login(fixture.approver1Email, TEST_CREDENTIALS.password);
      cy.request({
        method: 'POST',
        url: `/api/approval_request/${fixture.approvalRequest1Id}/approve`,
        body: {},
      })
        .its('status')
        .should('eq', 200);

      // The stage-2 approver must now have a real, DB-persisted
      // 'approval_order_reached' notification, readable through the exact
      // endpoint the bell polls — exactly one, not a duplicate of the
      // creation-time 'approval_requested' notification they already had.
      cy.login(fixture.approver2Email, TEST_CREDENTIALS.password);
      cy.request('/api/notifications').then((res) => {
        const items = res.body.items as Array<{ type: string; payload: { title?: string } }>;
        const created = items.filter((n) => n.type === 'approval_requested');
        const orderReached = items.filter((n) => n.type === 'approval_order_reached');
        expect(created, 'creation-time notification still present, not duplicated').to.have.length(1);
        expect(orderReached, 'stage-2 approver receives exactly one order-reached notification').to.have.length(1);
        expect(orderReached[0].payload.title).to.contain('Your approval is now needed');
      });
    });
  });
});

// The UI's ApprovalSection.tsx calls the server action
// (lib/approval_request/actions_core.ts's approveApprovalRequest) rather
// than this REST route (cmd_479's "two independent implementations" of
// approve). Cypress e2e can't invoke a 'use server' binding directly
// without a React tree wired to call it, so that path's order-reached
// notification is covered instead by a unit test asserting
// approveApprovalRequest() calls notifyApprovalOrderReached() with the
// newly-actionable flow id — see lib/approval_request/actions.test.ts.
