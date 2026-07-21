// cmd_318: Trigger #2 permanent fix (notifyApprovalRequestCreated wired into
// service_after_create_stub.ts.jinja2) + Trigger #1 regression coverage.
import { TEST_API_KEY } from '../../../../app-generator/cypress/support/test-credentials';

const LEAVE_REQUEST_API_BASE = '/api/leave_request';

describe('API: Approval / Assignment Notifications', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('Trigger #2: approval_request creation notifies approvers', () => {
    it('notifies the approver-role holder when a leave_request is created', () => {
      cy.task<any>('db:setupLeaveRequestApprovalFlow').then((setup) => {
        cy.request({
          method: 'POST',
          url: LEAVE_REQUEST_API_BASE,
          headers: { 'X-API-Key': setup.requestorUser.api_key },
          body: {
            user_id: setup.requestorUser.id,
            start_date: '2025-01-15T09:00:00.000Z',
            end_date: '2025-01-15T17:00:00.000Z',
            reason: 'Test Reason',
          },
        }).then((res) => {
          expect(res.status).to.eq(201);

          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser.email, 'test-password');
          cy.request({ url: '/api/notifications' }).then((notifRes) => {
            expect(notifRes.status).to.eq(200);
            const approvalNotifications = notifRes.body.items.filter(
              (n: any) => n.type === 'approval_requested' && n.payload.entityName === 'leave_request',
            );
            expect(approvalNotifications.length).to.be.greaterThan(0);
          });
        });
      });
    });

    it('does not notify the requestor (creator) themselves', () => {
      cy.task<any>('db:setupLeaveRequestApprovalFlow').then((setup) => {
        cy.request({
          method: 'POST',
          url: LEAVE_REQUEST_API_BASE,
          headers: { 'X-API-Key': setup.requestorUser.api_key },
          body: {
            user_id: setup.requestorUser.id,
            start_date: '2025-01-15T09:00:00.000Z',
            end_date: '2025-01-15T17:00:00.000Z',
            reason: 'Test Reason',
          },
        }).then((res) => {
          expect(res.status).to.eq(201);

          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.requestorUser.email, 'test-password');
          cy.request({ url: '/api/notifications' }).then((notifRes) => {
            expect(notifRes.status).to.eq(200);
            const approvalNotifications = notifRes.body.items.filter(
              (n: any) => n.type === 'approval_requested',
            );
            expect(approvalNotifications).to.have.length(0);
          });
        });
      });
    });
  });

  describe('Trigger #1 regression: assignee still gets notified', () => {
    it('notifies the assignee when a procedure is created with an assignee (unaffected by Trigger #2 change)', () => {
      cy.task<any>('db:setupLeaveRequestApprovalFlow').then((setup) => {
        cy.request({
          method: 'POST',
          url: '/api/procedure',
          headers: { 'X-API-Key': TEST_API_KEY },
          body: {
            name: 'Test Procedure For Notification',
            assignee_id: setup.approverUser.id,
          },
        }).then((res) => {
          expect(res.status).to.eq(201);

          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser.email, 'test-password');
          cy.request({ url: '/api/notifications' }).then((notifRes) => {
            expect(notifRes.status).to.eq(200);
            const assignedNotifications = notifRes.body.items.filter(
              (n: any) => n.type === 'assigned' && n.payload.itemType === 'procedure',
            );
            expect(assignedNotifications.length).to.be.greaterThan(0);
          });
        });
      });
    });
  });
});
