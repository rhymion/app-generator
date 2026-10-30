import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

// Permanent gate spec: the explicit submit action of an approval entity answers like the ordinary edit
// path. The actor's update permission on the target row (organization scope included) is verified before
// anything else, and a row the actor cannot see is answered exactly like a row that does not exist.
// The action is called over HTTP the way the browser calls it, with a real session cookie.
const headers = { 'X-API-Key': TEST_API_KEY };

type Footprint = { status: string; requests: number; history: number };
let orgId = '';
let seq = 0;

function actionId() {
  return cy.readFile('.next/server/server-reference-manifest.json').then((m: { node: Record<string, { filename?: string; exportedName?: string }> }) => {
    const hit = Object.entries(m.node).find(([, v]) => v.exportedName === 'submitForApprovalVoItemVersion');
    expect(hit, 'the submit action is in the manifest').to.not.eq(undefined);
    return hit![0];
  });
}

// Calls the action as the logged-in user and returns the text it answered with.
function submitAs(email: string, versionId: string) {
  cy.login(email, TEST_CREDENTIALS.password);
  return actionId().then((id) =>
    cy
      .request({
        method: 'POST',
        // The action is bundled with the page that renders it; the request must target that page.
        url: `/vo_item_version/view/${encodeURIComponent(versionId)}`,
        headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component' },
        body: JSON.stringify([versionId]),
        failOnStatusCode: false,
      })
      .then((res) => ({ status: res.status, text: (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)) })),
  );
}

function newDraft() {
  return cy
    .request({ method: 'POST', url: '/api/vo_item', headers, body: { name: `Widget-${++seq}` } })
    .then((item) =>
      cy.request({
        method: 'POST',
        url: '/api/vo_item_version',
        headers,
        body: { vo_item_id: (item.body as { id: string }).id, organization_id: orgId, title: 'draft', ref_code: `ref-${++seq}`, status: 'draft' },
      }),
    )
    .then((res) => {
      expect(res.status).to.eq(201);
      return (res.body as { id: string }).id;
    });
}

function expectUntouched(versionId: string) {
  cy.task<Footprint>('db:voSubmitFootprint', versionId).should('deep.eq', { status: 'draft', requests: 0, history: 0 });
}

describe('submit action authorization (generated runtime behaviour)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    cy.task('db:setupVoApprover', TEST_CREDENTIALS.email);
    cy.task<{ own: string }>('db:voSeedOrgs', TEST_CREDENTIALS.email).then((orgs) => { orgId = orgs.own; });
  });

  it('refuses a member without update permission, and leaves the row and the approval records unchanged', () => {
    newDraft().then((versionId) => {
      cy.task<string>('db:createSessionUserWithPermission', { entityName: 'vo_item_version', flags: { read: true }, label: 'readonly' }).then((email) => {
        cy.task('db:voEnrollUser', { email, orgId });
        submitAs(email, versionId).then((r) => {
          expect(r.text).to.contain('PERMISSION_DENIED');
        });
        expectUntouched(versionId);
      });
    });
  });

  it('answers an actor outside the row\'s organization exactly like a row that does not exist', () => {
    newDraft().then((versionId) => {
      cy.task<string>('db:createSessionUserWithPermission', { entityName: 'vo_item_version', flags: { read: true, update: true, create: true }, label: 'foreign' }).then((email) => {
        submitAs(email, versionId).then((foreign) => {
          submitAs(email, 'does-not-exist-0000000000').then((missing) => {
            expect(foreign.text).to.contain('NOT_FOUND');
            expect(foreign.status).to.eq(missing.status);
            expect(foreign.text, 'same answer for a hidden row and a missing row').to.eq(missing.text);
          });
        });
        expectUntouched(versionId);
      });
    });
  });

  it('still lets an actor with update permission in the row\'s organization submit', () => {
    newDraft().then((versionId) => {
      submitAs(TEST_CREDENTIALS.email, versionId).then((r) => {
        cy.log(r.text);
        expect(r.text, `status ${r.status}`).to.not.contain('PERMISSION_DENIED').and.not.contain('NOT_FOUND').and.not.contain('UNKNOWN');
      });
      cy.task<Footprint>('db:voSubmitFootprint', versionId).then((f) => {
        expect(f.requests, 'one approval request').to.eq(1);
        expect(f.status).to.eq('pending');
      });
    });
  });
});
