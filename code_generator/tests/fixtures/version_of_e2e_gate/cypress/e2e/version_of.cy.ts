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

let orgId = '';

function saveButton() {
  return cy.get('main form button[type="submit"]');
}

function createVersion(itemId: string, status: 'draft' | 'pending', lines = 0, extra: Record<string, unknown> = {}) {
  return cy.request({
    method: 'POST',
    url: '/api/vo_item_version',
    headers,
    failOnStatusCode: false,
    body: {
      vo_item_id: itemId,
      organization_id: orgId,
      title: `v-${status}`,
      summary: 'kept summary',
      ref_code: `ref-${++lineSeq}`,
      status,
      ...extra,
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

function reject(versionId: string) {
  cy.task<string | null>('db:voPendingRequestId', versionId).then((requestId) => {
    expect(requestId, 'a pending approval request').to.be.a('string');
    cy.request({ method: 'POST', url: `/api/approval_request/${requestId}/reject`, headers, body: {} })
      .its('status')
      .should('eq', 200);
  });
}

// vo_doc / vo_doc_version: the pair whose rejection is not terminal.
function createDoc(name = 'Manual') {
  return cy
    .request({ method: 'POST', url: '/api/vo_doc', headers, body: { name } })
    .then((res) => {
      expect(res.status).to.eq(201);
      return (res.body as { id: string }).id;
    });
}

function createDocVersion(docId: string, status: 'draft' | 'pending') {
  return cy.request({
    method: 'POST',
    url: '/api/vo_doc_version',
    headers,
    failOnStatusCode: false,
    body: { vo_doc_id: docId, title: `d-${status}`, status },
  });
}

// Fix and resubmit: put the version back to the submit value.
function resubmitDocVersion(versionId: string) {
  cy.request({ method: 'GET', url: `/api/vo_doc_version/${versionId}`, headers }).then((cur) => {
    cy.request({
      method: 'PUT', url: `/api/vo_doc_version/${versionId}`, headers,
      body: { ...cur.body, title: 'fixed', status: 'pending' },
    }).its('status').should('eq', 200);
  });
}

function approveDoc(versionId: string) {
  cy.task<string | null>('db:voDocPendingRequestId', versionId).then((requestId) => {
    expect(requestId, 'a pending approval request after resubmission').to.be.a('string');
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
    cy.task<{ own: string }>('db:voSeedOrgs', TEST_CREDENTIALS.email).then((orgs) => { orgId = orgs.own; });
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

  it('keeps a terminally rejected version as a closed record: no number, frozen, and the next draft can be created', () => {
    createItem().then((itemId) => {
      createVersion(itemId, 'pending', 2).then((res) => {
        const v1 = (res.body as { id: string }).id;
        approve(v1);
      });
      createVersion(itemId, 'pending', 2).then((res) => {
        const v2 = (res.body as { id: string }).id;
        reject(v2);
        cy.task<string[]>('db:voRequestStatuses', v2).should('deep.eq', ['terminal_rejected']);
        // (e) a rejected version never takes a number; the record and its rows stay
        cy.task<State>('db:voState', itemId).then((s) => {
          expect(s.versions.map((v) => [v.version_no, v.status])).to.deep.eq([[1, 'approved'], [null, 'rejected']]);
          expect(s.current_version_id, 'the approved version stays current').to.not.eq(v2);
        });
        cy.task<number>('db:voLineCount', v2).should('eq', 2);
        // (d) the freeze holds: edit and delete are refused, the row is unchanged
        cy.request({ method: 'GET', url: `/api/vo_item_version/${v2}`, headers }).then((cur) => {
          cy.request({
            method: 'PUT', url: `/api/vo_item_version/${v2}`, headers, failOnStatusCode: false,
            body: { ...cur.body, title: 'edited after rejection' },
          }).its('status').should('be.within', 400, 499);
        });
        cy.request({ method: 'DELETE', url: `/api/vo_item_version/${v2}`, headers, failOnStatusCode: false })
          .its('status').should('be.within', 400, 499);
        cy.task<State>('db:voState', itemId).then((s) => expect(s.versions).to.have.length(2));
        cy.task<number>('db:voLineCount', v2).should('eq', 2);
        // (a) the identity is free for a new version draft, by the API and by the new version screen
        cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
        cy.visit(`/en/vo_item_version/new?new_version_of=${itemId}`);
        cy.get('input').should(($inputs) => {
          expect([...$inputs].map((i) => (i as HTMLInputElement).value), 'the screen opens filled').to.include('v-pending');
        });
        cy.contains('already has an open draft').should('not.exist');
        createVersion(itemId, 'pending', 1).then((res3) => {
          expect(res3.status).to.eq(201);
          approve((res3.body as { id: string }).id);
          cy.task<State>('db:voState', itemId).then((s) => {
            expect(s.versions.map((v) => v.version_no), 'the rejected version does not use up a number').to.deep.eq([1, null, 2]);
          });
        });
      });
    });
  });

  it('ignores a version number sent by the client: create stores none, update keeps the stored value', () => {
    createItem().then((itemId) => {
      // a form submits an empty numeric field as 0; two such rows must not collide on (identity, number)
      createVersion(itemId, 'draft', 0, { version_no: 0 }).then((res) => {
        expect(res.status).to.eq(201);
        const v1 = (res.body as { id: string }).id;
        cy.task<State>('db:voState', itemId).then((s) => expect(s.versions.map((v) => v.version_no)).to.deep.eq([null]));
        // an edit of the draft, submitted in the same write, sends the number again
        cy.request({ method: 'GET', url: `/api/vo_item_version/${v1}`, headers }).then((cur) => {
          cy.request({
            method: 'PUT', url: `/api/vo_item_version/${v1}`, headers,
            body: { ...cur.body, title: 'edited', version_no: 0, status: 'pending' },
          }).its('status').should('eq', 200);
        });
        cy.task<State>('db:voState', itemId).then((s) => expect(s.versions.map((v) => v.version_no), 'an edit writes no number').to.deep.eq([null]));
        approve(v1);
        cy.task<State>('db:voState', itemId).then((s) => expect(s.versions.map((v) => v.version_no)).to.deep.eq([1]));
        createVersion(itemId, 'draft', 0, { version_no: 0 }).then((res2) => {
          expect(res2.status, 'a second row sent with 0 does not collide').to.eq(201);
          const v2 = (res2.body as { id: string }).id;
          cy.request({ method: 'GET', url: `/api/vo_item_version/${v2}`, headers }).then((cur) => {
            cy.request({
              method: 'PUT', url: `/api/vo_item_version/${v2}`, headers,
              body: { ...cur.body, version_no: 1 },
            }).its('status').should('eq', 200);
          });
          cy.task<State>('db:voState', itemId).then((s) => expect(s.versions.map((v) => v.version_no), 'a sent 1 is dropped too').to.deep.eq([1, null]));
        });
      });
    });
  });

  it('keeps a version rejected without terminal as the open draft, which can be fixed and resubmitted', () => {
    createDoc().then((docId) => {
      createDocVersion(docId, 'pending').then((res) => {
        const v1 = (res.body as { id: string }).id;
        cy.task<string | null>('db:voDocPendingRequestId', v1).then((requestId) => {
          cy.request({ method: 'POST', url: `/api/approval_request/${requestId}/reject`, headers, body: {} }).its('status').should('eq', 200);
        });
        // (b) the version is still the open draft: a new one is refused, the version is not deleted
        createDocVersion(docId, 'draft').then((res2) => {
          expect(res2.status).to.be.within(400, 499);
          expect(JSON.stringify(res2.body)).to.contain('is still open');
        });
        cy.task<State>('db:voDocState', docId).then((s) => expect(s.versions.map((v) => v.id)).to.deep.eq([v1]));
        resubmitDocVersion(v1);
        approveDoc(v1);
        cy.task<State>('db:voDocState', docId).then((s) => {
          expect(s.versions).to.deep.eq([{ id: v1, version_no: 1, status: 'approved' }]);
        });
      });
    });
  });

  it('keeps a withdrawn version as the open draft, which can be resubmitted', () => {
    createDoc().then((docId) => {
      createDocVersion(docId, 'pending').then((res) => {
        const v1 = (res.body as { id: string }).id;
        cy.task<string | null>('db:voDocPendingRequestId', v1).then((requestId) => {
          cy.request({ method: 'POST', url: `/api/approval_request/${requestId}/withdraw`, headers, body: {} }).its('status').should('eq', 200);
        });
        // (c) same as after a non-terminal rejection
        createDocVersion(docId, 'draft').then((res2) => {
          expect(res2.status).to.be.within(400, 499);
          expect(JSON.stringify(res2.body)).to.contain('is still open');
        });
        cy.task<State>('db:voDocState', docId).then((s) => expect(s.versions.map((v) => v.id)).to.deep.eq([v1]));
        resubmitDocVersion(v1);
        approveDoc(v1);
        cy.task<State>('db:voDocState', docId).then((s) => expect(s.versions[0].version_no).to.eq(1));
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
          cy.get('input').should(($inputs) => {
            const values = [...$inputs].map((i) => (i as HTMLInputElement).value);
            expect(values, 'title and summary carried over').to.include.members(['v-pending', 'kept summary']);
            expect(values.some((v) => v.startsWith('ref-')), 'a unique column is not carried').to.eq(false);
          });
          cy.contains('line 0');
          cy.contains('line 1');
          // nothing is written by opening the screen
          cy.task<State>('db:voState', itemId).then((s) => expect(s.versions).to.have.length(1));
          // A unique, required child column is left for the user to fill in. The save button is
          // looked up inside <main>: while React streams the page, a hidden copy of the form sits
          // in a detached buffer (div#S:0[hidden]) for a few tens of milliseconds next to the
          // revealed one, so a document-wide lookup can find two submit buttons.
          saveButton().click();
          cy.task<State>('db:voState', itemId).then((s) => expect(s.versions, 'blocked until the codes are given').to.have.length(1));
          ['new-code-a', 'new-code-b'].forEach((code, i) => {
            cy.get(`[role="row"][data-rowindex="${i}"] [data-field="line_code"]`).dblclick();
            cy.focused().type(`${code}{enter}`);
          });
          saveButton().click();
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

  describe('identity tombstone', () => {
    it('refuses to delete an identity that has an approved version, and deletes one with only a draft', () => {
      createItem('Approved').then((itemId) => {
        createVersion(itemId, 'pending').then((res) => approve((res.body as { id: string }).id));
        cy.request({ method: 'DELETE', url: `/api/vo_item/${itemId}`, headers, failOnStatusCode: false })
          .its('status')
          .should('be.within', 400, 499);
        cy.task<State>('db:voState', itemId).then((s) => expect(s.versions).to.have.length(1));
      });
      createItem('Draft only').then((itemId) => {
        createVersion(itemId, 'draft').its('status').should('eq', 201);
        cy.request({ method: 'DELETE', url: `/api/vo_item/${itemId}`, headers }).its('status').should('be.within', 200, 204);
        cy.request({ method: 'GET', url: `/api/vo_item/${itemId}`, headers, failOnStatusCode: false })
          .its('status')
          .should('eq', 404);
      });
    });

    it('refuses a new draft for an invalidated identity, and keeps its versions', () => {
      createItem('Retired').then((itemId) => {
        createVersion(itemId, 'pending').then((res) => approve((res.body as { id: string }).id));
        cy.request({ method: 'POST', url: `/api/vo_item/${itemId}/actions/invalidate`, headers, body: {} })
          .its('status')
          .should('eq', 200);
        createVersion(itemId, 'draft').then((res) => {
          expect(res.status).to.be.within(400, 499);
          expect(JSON.stringify(res.body)).to.contain('invalidated');
        });
        cy.task<State>('db:voState', itemId).then((s) => {
          expect(s.versions.map((v) => v.version_no), 'approved version stays').to.deep.eq([1]);
        });
      });
    });
  });
});
