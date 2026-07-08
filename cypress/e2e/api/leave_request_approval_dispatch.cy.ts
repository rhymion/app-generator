// Regression tests for post-approval event firing (cmd_207)
// Tests DP-1~4: approved_at idempotency, set_fields, emit_hook stub, reject non-fire.

describe('API: Leave Request — Approval Event Dispatch', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('16. Post-approval event firing (dispatchOnApproved)', () => {
    it('16.1 final approval fires dispatch: set_fields updates leave_request.status to approved', () => {
      cy.task<any>('db:setupLeaveRequestApprovalFlow').then((setup) => {
        cy.task<any>('db:populateLeaveRequestWithApproval', {
          creatorId: setup.requestorUser.id,
          approvalFlowIds: [setup.flowWithRole.id],
        }).then((data) => {
          // Pre-check: status should be default "pending", approved_at null
          cy.request({
            url: `/api/leave_request/${data.record.id}`,
            headers: { 'X-API-Key': setup.approverUser.api_key },
          }).then((getRes) => {
            expect(getRes.body.status).to.eq(0);
            expect(getRes.body.approvable.approved_at).to.be.null;
          });

          const arId = data.approvalRequests[0].id;
          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser.email, 'test-password');
          cy.request({
            method: 'POST',
            url: `/api/approval_request/${arId}/approve`,
          }).then((res) => {
            expect(res.status).to.eq(200);

            // Post-check: set_fields must have updated status to "approved"
            cy.request({
              url: `/api/leave_request/${data.record.id}`,
              headers: { 'X-API-Key': setup.approverUser.api_key },
            }).then((getRes) => {
              expect(getRes.body.status).to.eq(1);
              expect(getRes.body.approvable.approved_at).to.not.be.null;
            });
          });
        });
      });
    });

    it('16.2 non-final approval does not fire dispatch (approved_at remains null)', () => {
      cy.task<any>('db:setupLeaveRequestOrderedApprovalFlow').then((setup) => {
        cy.task<any>('db:populateLeaveRequestWithApproval', {
          creatorId: setup.approverUser1.id,
          approvalFlowIds: [setup.flow1.id, setup.flow2.id],
        }).then((data) => {
          const ar1 = data.approvalRequests.find((r: any) => r.approval_flow_id === setup.flow1.id);

          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser1.email, 'test-password');
          cy.request({
            method: 'POST',
            url: `/api/approval_request/${ar1.id}/approve`,
          }).then(() => {
            // Only flow1 approved — dispatch must NOT have fired
            cy.request({
              url: `/api/leave_request/${data.record.id}`,
              headers: { 'X-API-Key': setup.approverUser1.api_key },
            }).then((getRes) => {
              expect(getRes.body.status).to.eq(0);
              expect(getRes.body.approvable.approved_at).to.be.null;
            });
          });
        });
      });
    });

    it('16.3 reject fires on_rejected dispatch: status updated to rejected(2), approved_at stays null', () => {
      cy.task<any>('db:setupLeaveRequestApprovalFlow').then((setup) => {
        cy.task<any>('db:populateLeaveRequestWithApproval', {
          creatorId: setup.requestorUser.id,
          approvalFlowIds: [setup.flowWithRole.id],
        }).then((data) => {
          const arId = data.approvalRequests[0].id;
          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser.email, 'test-password');
          cy.request({
            method: 'POST',
            url: `/api/approval_request/${arId}/reject`,
          }).then((res) => {
            expect(res.status).to.eq(200);

            cy.request({
              url: `/api/leave_request/${data.record.id}`,
              headers: { 'X-API-Key': setup.approverUser.api_key },
            }).then((getRes) => {
              expect(getRes.body.status).to.eq(2);
              expect(getRes.body.approvable.approved_at).to.be.null;
            });
          });
        });
      });
    });

    it('16.5 reject with reason persists it to approvable.rejection_reason', () => {
      cy.task<any>('db:setupLeaveRequestApprovalFlow').then((setup) => {
        cy.task<any>('db:populateLeaveRequestWithApproval', {
          creatorId: setup.requestorUser.id,
          approvalFlowIds: [setup.flowWithRole.id],
        }).then((data) => {
          const arId = data.approvalRequests[0].id;
          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser.email, 'test-password');
          cy.request({
            method: 'POST',
            url: `/api/approval_request/${arId}/reject`,
            body: { reason: 'Insufficient staffing coverage on requested dates' },
          }).then((res) => {
            expect(res.status).to.eq(200);

            cy.request({
              url: `/api/leave_request/${data.record.id}`,
              headers: { 'X-API-Key': setup.approverUser.api_key },
            }).then((getRes) => {
              expect(getRes.body.status).to.eq(2);
              expect(getRes.body.approvable.rejection_reason).to.eq('Insufficient staffing coverage on requested dates');
            });
          });
        });
      });
    });

    it('16.6 reject without reason leaves approvable.rejection_reason null (backward compat)', () => {
      cy.task<any>('db:setupLeaveRequestApprovalFlow').then((setup) => {
        cy.task<any>('db:populateLeaveRequestWithApproval', {
          creatorId: setup.requestorUser.id,
          approvalFlowIds: [setup.flowWithRole.id],
        }).then((data) => {
          const arId = data.approvalRequests[0].id;
          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser.email, 'test-password');
          cy.request({
            method: 'POST',
            url: `/api/approval_request/${arId}/reject`,
          }).then((res) => {
            expect(res.status).to.eq(200);

            cy.request({
              url: `/api/leave_request/${data.record.id}`,
              headers: { 'X-API-Key': setup.approverUser.api_key },
            }).then((getRes) => {
              expect(getRes.body.status).to.eq(2);
              expect(getRes.body.approvable.rejection_reason).to.be.null;
            });
          });
        });
      });
    });

    it('16.4 approved_at set exactly once — double-approve does not update timestamp', () => {
      cy.task<any>('db:setupLeaveRequestApprovalFlow').then((setup) => {
        cy.task<any>('db:populateLeaveRequestWithApproval', {
          creatorId: setup.requestorUser.id,
          approvalFlowIds: [setup.flowWithRole.id],
        }).then((data) => {
          const arId = data.approvalRequests[0].id;

          // First approval — fires dispatch, sets approved_at
          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(setup.approverUser.email, 'test-password');
          cy.request({
            method: 'POST',
            url: `/api/approval_request/${arId}/approve`,
          }).then(() => {
            cy.request({
              url: `/api/leave_request/${data.record.id}`,
              headers: { 'X-API-Key': setup.approverUser.api_key },
            }).then((getRes) => {
              const firstApprovedAt = getRes.body.approvable.approved_at;
              expect(firstApprovedAt).to.not.be.null;

              // Second approval of same request (already approved) — must not re-fire
              cy.request({
                method: 'POST',
                url: `/api/approval_request/${arId}/approve`,
              }).then(() => {
                cy.request({
                  url: `/api/leave_request/${data.record.id}`,
                  headers: { 'X-API-Key': setup.approverUser.api_key },
                }).then((getRes2) => {
                  // approved_at must be identical — not updated on second fire
                  expect(getRes2.body.approvable.approved_at).to.eq(firstApprovedAt);
                });
              });
            });
          });
        });
      });
    });
  });
});
