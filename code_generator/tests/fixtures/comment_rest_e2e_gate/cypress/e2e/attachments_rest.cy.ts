// Hand-written -- not part of the generated entity test set.
// PUT /api/cr_asset/{id}/attachments: the REST side of the attachment panel (AttachmentSection) the web edit
// form uses, for an entity that owns attachments through the `attachable` bridge and is scoped by organization.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

type Asset = { id: string; organization_id: string; attachable_id: string };
type Attachment = { id: string; name: string; path: string; type: string; order: number };

const url = (assetId: string) => `/api/cr_asset/${assetId}/attachments`;
const asKey = (key = TEST_API_KEY) => ({ 'X-API-Key': key });

function listAttachments(assetId: string, key = TEST_API_KEY) {
  return cy
    .request({ url: `/api/cr_asset/${assetId}`, headers: asKey(key) })
    .then((res) => ((res.body.attachable?.attachments as Attachment[]) ?? []).slice().sort((a, b) => a.order - b.order));
}

function put(assetId: string, body: unknown, key = TEST_API_KEY) {
  return cy.request({ method: 'PUT', url: url(assetId), headers: asKey(key), body, failOnStatusCode: false });
}

const file = (name: string) => ({ name, path: `/uploads/${name}` });

describe('API: attachment writes', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('authentication', () => {
    it('rejects a request without credentials and an invalid API key', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        cy.request({ method: 'PUT', url: url(asset.id), body: { type: 'file', items: [] }, failOnStatusCode: false })
          .its('status')
          .should('eq', 401);
        put(asset.id, { type: 'file', items: [] }, 'not-a-real-key').its('status').should('eq', 401);
      });
    });

    it('accepts a mobile access token', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        cy.request('POST', '/api/mobile/auth/token', {
          email: TEST_CREDENTIALS.email,
          password: TEST_CREDENTIALS.password,
        }).then((login) => {
          const headers = { Authorization: `Bearer ${(login.body as { access_token: string }).access_token}` };
          cy.request({ method: 'PUT', url: url(asset.id), headers, body: { type: 'file', items: [file('from-mobile.pdf')] } })
            .its('status')
            .should('eq', 200);
          listAttachments(asset.id).then((rows) => expect(rows.map((r) => r.path)).to.deep.equal(['/uploads/from-mobile.pdf']));
        });
      });
    });
  });

  describe('replace semantics', () => {
    it('stores the listed files in the listed order, then replaces, reorders and removes', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        put(asset.id, { type: 'file', items: [file('a.pdf'), file('b.pdf')] }).its('status').should('eq', 200);
        listAttachments(asset.id).then((rows) => {
          expect(rows.map((r) => [r.name, r.type, r.order])).to.deep.equal([['a.pdf', 'file', 0], ['b.pdf', 'file', 1]]);
          const [a, b] = rows;
          // Reorder (b first), keep both rows, add a third.
          put(asset.id, { type: 'file', items: [{ id: b.id, ...file('b.pdf') }, { id: a.id, ...file('a.pdf') }, file('c.pdf')] })
            .its('status')
            .should('eq', 200);
          listAttachments(asset.id).then((after) => {
            expect(after.map((r) => r.name)).to.deep.equal(['b.pdf', 'a.pdf', 'c.pdf']);
            expect(after[0].id).to.eq(b.id);
            expect(after[1].id).to.eq(a.id);
            // Remove one: the row not listed is deleted.
            put(asset.id, { type: 'file', items: [{ id: a.id, ...file('a.pdf') }] }).its('status').should('eq', 200);
            listAttachments(asset.id).then((last) => expect(last.map((r) => r.id)).to.deep.equal([a.id]));
          });
        });
      });
    });

    it('replaces only the type it was sent: images and files are separate sets', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        put(asset.id, { type: 'image', items: [file('p.png')] }).its('status').should('eq', 200);
        put(asset.id, { type: 'file', items: [file('d.pdf')] }).its('status').should('eq', 200);
        put(asset.id, { type: 'file', items: [] }).its('status').should('eq', 200);
        listAttachments(asset.id).then((rows) => expect(rows.map((r) => [r.type, r.name])).to.deep.equal([['image', 'p.png']]));
      });
    });

    it('rejects a malformed body and writes nothing', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        const bad: unknown[] = [
          { items: [] },
          { type: 'nonsense', items: [] },
          { type: 'file' },
          { type: 'file', items: 'x' },
          { type: 'file', items: [{ path: '/uploads/x.pdf' }] },
          { type: 'file', items: [{ name: '', path: '/uploads/x.pdf' }] },
          { type: 'file', items: [{ name: 'x.pdf', path: '//evil.example/x.pdf' }] },
          { type: 'file', items: [{ name: 'x.pdf', path: 'javascript:alert(1)' }] },
          { type: 'file', items: [{ id: 'not-held', ...file('x.pdf') }] },
        ];
        for (const body of bad) put(asset.id, body).its('status').should('eq', 400);
        cy.request({ method: 'PUT', url: url(asset.id), headers: { ...asKey(), 'Content-Type': 'application/json' }, body: 'not json', failOnStatusCode: false })
          .its('status')
          .should('eq', 400);
        listAttachments(asset.id).then((rows) => expect(rows).to.have.length(0));
      });
    });

    it('answers 404 for a record that does not exist', () => {
      put('does-not-exist', { type: 'file', items: [] }).its('status').should('eq', 404);
    });
  });

  describe('permission', () => {
    it('answers 403 when the caller cannot update the record, and writes nothing', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_asset',
          flags: { read: true },
          label: 'readonly',
          organizationId: asset.organization_id,
        }).then((key) => {
          put(asset.id, { type: 'file', items: [file('x.pdf')] }, key).its('status').should('eq', 403);
          listAttachments(asset.id).then((rows) => expect(rows).to.have.length(0));
        });
      });
    });

    it('lets a caller who can update the record set its attachments', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_asset',
          flags: { read: true, update: true },
          label: 'updater',
          organizationId: asset.organization_id,
        }).then((key) => {
          put(asset.id, { type: 'file', items: [file('x.pdf')] }, key).its('status').should('eq', 200);
        });
      });
    });
  });

  describe('organization isolation', () => {
    it('answers 404 for a record of a foreign organization and writes nothing', () => {
      cy.task<Asset[]>('db:populateCrAsset', 2).then(([own, foreign]) => {
        put(foreign.id, { type: 'file', items: [file('seed.pdf')] }).its('status').should('eq', 200);
        cy.task('db:createCrossOrgScenario', { entityName: 'cr_asset', entityId: foreign.id }).then(() => {
          put(foreign.id, { type: 'file', items: [file('from-outside.pdf')] }).its('status').should('eq', 404);
          put(foreign.id, { type: 'file', items: [] }).its('status').should('eq', 404);
          // The record of the caller's own organization is still reachable.
          put(own.id, { type: 'file', items: [file('inside.pdf')] }).its('status').should('eq', 200);
        });
      });
    });

    it('refuses to take over an attachment of another record by naming its id', () => {
      cy.task<Asset[]>('db:populateCrAsset', 2).then(([mine, other]) => {
        put(other.id, { type: 'file', items: [file('theirs.pdf')] }).its('status').should('eq', 200);
        listAttachments(other.id).then(([theirs]) => {
          put(mine.id, { type: 'file', items: [{ id: theirs.id, ...file('stolen.pdf') }] }).its('status').should('eq', 400);
          listAttachments(mine.id).then((rows) => expect(rows).to.have.length(0));
          listAttachments(other.id).then((rows) => {
            expect(rows.map((r) => [r.id, r.name])).to.deep.equal([[theirs.id, theirs.name]]);
          });
        });
      });
    });
  });
});
