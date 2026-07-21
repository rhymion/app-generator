// Closes a mandatory-gate coverage gap found while investigating why the
// receiving_receipt notification wiring (Trigger #1 assignee + Trigger #2
// approval) passed cy review but did not reproduce on a real machine:
// notification_approval.cy.ts only ever exercises leave_request/procedure,
// never receiving_receipt — so a receiving_receipt-specific regression in
// either trigger has no spec that would catch it. This spec exercises both
// triggers through the real POST /api/receiving_receipt path (not direct
// Prisma seeding), so it goes through the exact code path a real user hits.
import { TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/receiving_receipt';

describe('API: Receiving Receipt Notifications', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('Trigger #1: line assignee_id notifies the assignee', () => {
    it('notifies the assignee when a receiving_receipt is created with an assigned line', () => {
      cy.task<any>('db:setupReceivingReceiptNotificationFixture').then((setup) => {
        cy.request({
          method: 'POST',
          url: API_BASE,
          headers: { 'X-API-Key': setup.requestorUser.api_key },
          body: {
            receipt_no: `RR-NOTIF-${Date.now()}`,
            status: 0,
            lines: [
              {
                product_id: setup.product.id,
                receipt_quantity: 1,
                status: 0,
                assignee_id: setup.approverUser.id,
              },
            ],
          },
        }).then((res) => {
          expect(res.status).to.eq(201);

          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser.email, 'test-password');
          cy.request({ url: '/api/notifications' }).then((notifRes) => {
            expect(notifRes.status).to.eq(200);
            const assignedNotifications = notifRes.body.items.filter(
              (n: any) => n.type === 'assigned' && n.payload.itemType === 'receiving_receipt',
            );
            expect(assignedNotifications.length).to.be.greaterThan(0);
          });
        });
      });
    });
  });

  describe('Trigger #2: line approval_request creation notifies the approver-role holder', () => {
    it('notifies the approver-role holder when a receiving_receipt line is created under an approval_flow', () => {
      cy.task<any>('db:setupReceivingReceiptNotificationFixture').then((setup) => {
        cy.request({
          method: 'POST',
          url: API_BASE,
          headers: { 'X-API-Key': setup.requestorUser.api_key },
          body: {
            receipt_no: `RR-NOTIF-${Date.now()}`,
            status: 0,
            lines: [
              {
                product_id: setup.product.id,
                receipt_quantity: 1,
                status: 0,
              },
            ],
          },
        }).then((res) => {
          expect(res.status).to.eq(201);

          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser.email, 'test-password');
          cy.request({ url: '/api/notifications' }).then((notifRes) => {
            expect(notifRes.status).to.eq(200);
            const approvalNotifications = notifRes.body.items.filter(
              (n: any) => n.type === 'approval_requested' && n.payload.entityName === 'receiving_receipt_line',
            );
            expect(approvalNotifications.length).to.be.greaterThan(0);
          });
        });
      });
    });

    it('does not notify the requestor (creator) themselves', () => {
      cy.task<any>('db:setupReceivingReceiptNotificationFixture').then((setup) => {
        cy.request({
          method: 'POST',
          url: API_BASE,
          headers: { 'X-API-Key': setup.requestorUser.api_key },
          body: {
            receipt_no: `RR-NOTIF-${Date.now()}`,
            status: 0,
            lines: [
              {
                product_id: setup.product.id,
                receipt_quantity: 1,
                status: 0,
              },
            ],
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
});
