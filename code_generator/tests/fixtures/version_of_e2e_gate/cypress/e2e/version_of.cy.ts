import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

// Permanent gate spec for x-version-of: the generated runtime behaviour of an identity
// (vo_item) and its version entity (vo_item_version, with owned child rows).
type State = {
  current_version_id: string | null;
  versions: Array<{ id: string; version_no: number | null; status: string }>;
};

const headers = { 'X-API-Key': TEST_API_KEY };
let lineSeq = 0;

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
      summary: 'kept summary',
      ref_code: `ref-${++lineSeq}`,
      status,
      vo_item_version_lines: Array.from({ length: lines }, (_, i) => ({ line_code: `code-${++lineSeq}`, note: `line ${i}`, quantity: i + 1 })),
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

  describe('new version screen (prefilled create form)', () => {
    const newVersionUrl = (itemId: unknown) => `/en/vo_item_version/new?new_version_of=${String(itemId)}`;

    it('says so when the identity has no approved version or already has an open draft', () => {
      createItem().then((itemId) => {
        cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
        cy.visit(newVersionUrl(itemId));
        cy.contains('no approved version');
        createVersion(itemId, 'pending', 1).then((res) => {
          approve((res.body as { id: string }).id);
          createVersion(itemId, 'draft').its('status').should('eq', 201);
          cy.visit(newVersionUrl(itemId));
          cy.contains('already has an open draft');
        });
      });
    });

    it('opens filled with the current version, writes nothing until saved, then saves a new draft', () => {
      createItem().then((itemId) => {
        createVersion(itemId, 'pending', 2).then((res) => {
          const v1 = (res.body as { id: string }).id;
          approve(v1);
          cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
          cy.visit(newVersionUrl(itemId));
          cy.get('input').then(($inputs) => {
            const values = [...$inputs].map((i) => (i as HTMLInputElement).value);
            expect(values, 'title and summary carried over').to.include.members(['v-pending', 'kept summary']);
            expect(values.some((v) => v.startsWith('ref-')), 'a unique column is not carried').to.eq(false);
          });
          cy.contains('line 0');
          cy.contains('line 1');
          // nothing is written by opening the screen
          cy.task<State>('db:voState', itemId).then((s) => expect(s.versions).to.have.length(1));
          // a unique, required child column is left for the user to fill in
          cy.get('button[type="submit"]').click();
          cy.task<State>('db:voState', itemId).then((s) => expect(s.versions, 'blocked until the codes are given').to.have.length(1));
          ['new-code-a', 'new-code-b'].forEach((code, i) => {
            cy.get(`[role="row"][data-rowindex="${i}"] [data-field="line_code"]`).dblclick();
            cy.focused().type(`${code}{enter}`);
          });
          cy.get('button[type="submit"]').click();
          cy.location('pathname').should('eq', '/vo_item_version');
          cy.task<State>('db:voState', itemId).then((s) => {
            expect(s.versions).to.have.length(2);
            const draft = s.versions.find((v) => v.id !== v1)!;
            expect(draft.version_no, 'numbered at approval, not at save').to.eq(null);
            cy.task<{ title: string; status: string; ref_code: string | null; attachable_id: string; notes: string[]; codes: string[] }>('db:voDraft', draft.id).then((d) => {
              expect(d.title).to.eq('v-pending');
              expect(d.status, 'the submit field restarts at its default').to.eq('draft');
              expect(d.ref_code).to.eq(null);
              expect(d.notes).to.deep.eq(['line 0', 'line 1']);
              expect(d.codes).to.deep.eq(['new-code-a', 'new-code-b']);
              cy.task<string>('db:voAttachableId', v1).should('not.eq', d.attachable_id);
            });
            cy.task<number>('db:voLineCount', v1).should('eq', 2);
          });
        });
      });
    });
  });
});
