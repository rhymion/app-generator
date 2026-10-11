import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

// Permanent gate spec for x-version-of: the generated runtime behaviour of an identity
// (vo_item) and its version entity (vo_item_version, with owned child rows).
type State = {
  current_version_id: string | null;
  versions: Array<{ id: string; version_no: number | null; status: string }>;
};

const headers = { 'X-API-Key': TEST_API_KEY };

function createItem(name = 'Widget') {
  return cy
    .request({ method: 'POST', url: '/api/vo_item', headers, body: { name } })
    .then((res) => {
      expect(res.status).to.eq(201);
      return (res.body as { id: string }).id;
    });
}

function createVersion(itemId: string, status: 'draft' | 'pending', lines = 0) {
  return cy.request({
    method: 'POST',
    url: '/api/vo_item_version',
    headers,
    failOnStatusCode: false,
    body: {
      vo_item_id: itemId,
      title: `v-${status}`,
      status,
      vo_item_version_lines: Array.from({ length: lines }, (_, i) => ({ note: `line ${i}` })),
    },
  });
}

function approve(versionId: string) {
  cy.task<string | null>('db:voPendingRequestId', versionId).then((requestId) => {
    expect(requestId, 'a pending approval request').to.be.a('string');
    cy.request({ method: 'POST', url: `/api/approval_request/${requestId}/approve`, headers, body: {} })
      .its('status')
      .should('eq', 200);
  });
}

describe('x-version-of (generated runtime behaviour)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    cy.task('db:setupVoApprover', TEST_CREDENTIALS.email);
    Cypress.session.clearAllSavedSessions();
  });

  it('assigns the number at approval, keeps current_version_id in step, and numbers successive versions', () => {
    createItem().then((itemId) => {
      createVersion(itemId, 'pending').then((res) => {
        expect(res.status).to.eq(201);
        const v1 = (res.body as { id: string }).id;
        cy.task<State>('db:voState', itemId).then((s) => {
          expect(s.versions.map((v) => v.version_no), 'no number before approval').to.deep.eq([null]);
          expect(s.current_version_id).to.eq(null);
        });
        approve(v1);
        cy.task<State>('db:voState', itemId).then((s) => {
          expect(s.versions).to.deep.eq([{ id: v1, version_no: 1, status: 'approved' }]);
          expect(s.current_version_id).to.eq(v1);
        });
        createVersion(itemId, 'pending').then((res2) => {
          expect(res2.status).to.eq(201);
          const v2 = (res2.body as { id: string }).id;
          approve(v2);
          cy.task<State>('db:voState', itemId).then((s) => {
            expect(s.versions.map((v) => v.version_no)).to.deep.eq([1, 2]);
            expect(s.current_version_id).to.eq(v2);
          });
        });
      });
    });
  });

  it('refuses a second open draft of the same identity, and allows one for another identity', () => {
    createItem('First').then((itemId) => {
      createVersion(itemId, 'draft').its('status').should('eq', 201);
      createVersion(itemId, 'draft').then((res) => {
        expect(res.status).to.be.within(400, 499);
        expect(JSON.stringify(res.body)).to.contain('is still open');
      });
      cy.task<State>('db:voState', itemId).then((s) => expect(s.versions).to.have.length(1));
    });
    createItem('Second').then((otherId) => {
      createVersion(otherId, 'draft').its('status').should('eq', 201);
    });
  });

  it('deletes a terminally rejected draft together with its child rows, never an approved version', () => {
    createItem().then((itemId) => {
      createVersion(itemId, 'pending', 2).then((res) => {
        const v1 = (res.body as { id: string }).id;
        cy.task<number>('db:voLineCount', v1).should('eq', 2);
        approve(v1);
      });
      createVersion(itemId, 'pending', 2).then((res) => {
        const v2 = (res.body as { id: string }).id;
        cy.task<string | null>('db:voPendingRequestId', v2).then((requestId) => {
          cy.request({ method: 'POST', url: `/api/approval_request/${requestId}/reject`, headers, body: {} })
            .its('status')
            .should('eq', 200);
        });
        cy.task<number>('db:voLineCount', v2).should('eq', 0);
        cy.task<State>('db:voState', itemId).then((s) => {
          expect(s.versions.map((v) => v.version_no), 'only the approved version remains').to.deep.eq([1]);
        });
      });
    });
  });

  it('deletes a withdrawn draft together with its child rows', () => {
    createItem().then((itemId) => {
      createVersion(itemId, 'pending', 1).then((res) => {
        const v1 = (res.body as { id: string }).id;
        cy.task<string | null>('db:voPendingRequestId', v1).then((requestId) => {
          cy.request({ method: 'POST', url: `/api/approval_request/${requestId}/withdraw`, headers, body: {} })
            .its('status')
            .should('eq', 200);
        });
        cy.task<number>('db:voLineCount', v1).should('eq', 0);
        cy.task<State>('db:voState', itemId).then((s) => expect(s.versions).to.have.length(0));
        // the identity is free for a new draft again
        createVersion(itemId, 'draft').its('status').should('eq', 201);
      });
    });
  });

  describe('new draft from the current version', () => {
    function newDraft(itemId: unknown) {
      return cy.request({
        method: 'POST',
        url: '/api/vo_item_version/actions/new-draft',
        headers,
        failOnStatusCode: false,
        body: { vo_item_id: itemId },
      });
    }

    it('is refused while the identity has no approved version, and without an identity id', () => {
      createItem().then((itemId) => {
        newDraft(itemId).its('status').should('be.within', 400, 499);
        newDraft(undefined).its('status').should('be.within', 400, 499);
        newDraft('missing-id').its('status').should('be.within', 400, 499);
      });
    });

    it('copies the current version and its child rows into an unsubmitted draft without a number', () => {
      createItem().then((itemId) => {
        createVersion(itemId, 'pending', 2).then((res) => {
          const v1 = (res.body as { id: string }).id;
          approve(v1);
          newDraft(itemId).then((created) => {
            expect(created.status).to.eq(201);
            const draftId = (created.body as { id: string }).id;
            expect(draftId).to.not.eq(v1);
            cy.task<{ title: string; status: string; version_no: number | null; approvable_id: string; notes: string[] }>('db:voDraft', draftId).then((d) => {
              expect(d.title).to.eq('v-pending');
              expect(d.status, 'the submit field restarts at its default').to.eq('draft');
              expect(d.version_no, 'numbered at approval, not at copy').to.eq(null);
              expect(d.notes).to.deep.eq(['line 0', 'line 1']);
            });
            cy.task<number>('db:voLineCount', v1).should('eq', 2);
            // one open draft per identity: a second request is refused
            newDraft(itemId).its('status').should('be.within', 400, 499);
            // approving the draft numbers it and moves current_version_id
            cy.task<string | null>('db:voPendingRequestId', draftId).should('eq', null);
            cy.request({ method: 'PUT', url: `/api/vo_item_version/${draftId}`, headers, body: { vo_item_id: itemId, title: 'v-pending', status: 'pending' } }).its('status').should('eq', 200);
            approve(draftId);
            cy.task<State>('db:voState', itemId).then((s) => {
              expect(s.versions.map((v) => v.version_no)).to.deep.eq([1, 2]);
              expect(s.current_version_id).to.eq(draftId);
            });
          });
        });
      });
    });
  });
});
