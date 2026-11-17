// Hand-written -- not part of the generated entity test set.
// PUT /api/cr_asset/{id}/attachments: the REST side of the attachment panel (AttachmentSection) the web edit
// form uses, for an entity that owns attachments through the `attachable` bridge and is scoped by organization.
// Items are attachment ids: POST /api/upload stores a file and answers with the id; only the user who uploaded
// it can attach it to a record.
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

const BOUNDARY = '----attachmentsrestboundary';

/** A multipart body by hand: cy.request has no FormData support. */
function multipart(filename: string): string {
  return (
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/pdf\r\n\r\n` +
    // The route checks the leading bytes against the file's extension (a string body can only carry ASCII signatures).
    `${filename.endsWith('.gif') ? 'GIF89a' : '%PDF-1.4 '}contents of ${filename}\r\n` +
    `--${BOUNDARY}--\r\n`
  );
}

/** Uploads a file as the caller; answers the attachment id. */
function upload(name: string, key = TEST_API_KEY): Cypress.Chainable<string> {
  return cy
    .request({
      method: 'POST',
      url: '/api/upload',
      headers: { ...asKey(key), 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
      body: multipart(name),
    })
    .then((res) => res.body.id as string);
}

/** Uploads the named files and answers their ids, in order. */
function uploadAll(names: string[], key = TEST_API_KEY): Cypress.Chainable<string[]> {
  const ids: string[] = [];
  for (const name of names) upload(name, key).then((id) => ids.push(id));
  return cy.wrap(ids);
}

const items = (...ids: string[]) => ids.map((id) => ({ id }));

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
          upload('from-mobile.pdf').then((id) => {
            cy.request({ method: 'PUT', url: url(asset.id), headers, body: { type: 'file', items: items(id) } })
              .its('status')
              .should('eq', 200);
            listAttachments(asset.id).then((rows) => {
              expect(rows.map((r) => [r.id, r.name])).to.deep.equal([[id, 'from-mobile.pdf']]);
              // The REST detail carries the URL the file is delivered from, never a storage location.
              expect(rows[0].path).to.eq(`/api/attachments/${id}`);
            });
          });
        });
      });
    });
  });

  describe('replace semantics', () => {
    it('stores the listed files in the listed order, then replaces, reorders and removes', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        uploadAll(['a.pdf', 'b.pdf', 'c.pdf']).then(([a, b, c]) => {
          put(asset.id, { type: 'file', items: items(a, b) }).its('status').should('eq', 200);
          listAttachments(asset.id).then((rows) => {
            expect(rows.map((r) => [r.id, r.name, r.type, r.order])).to.deep.equal([[a, 'a.pdf', 'file', 0], [b, 'b.pdf', 'file', 1]]);
            // Reorder (b first), keep both rows, add a third.
            put(asset.id, { type: 'file', items: items(b, a, c) }).its('status').should('eq', 200);
            listAttachments(asset.id).then((after) => {
              expect(after.map((r) => r.id)).to.deep.equal([b, a, c]);
              // Remove one: the row not listed is deleted.
              put(asset.id, { type: 'file', items: items(a) }).its('status').should('eq', 200);
              listAttachments(asset.id).then((last) => expect(last.map((r) => r.id)).to.deep.equal([a]));
            });
          });
        });
      });
    });

    it('replaces only the type it was sent: images and files are separate sets', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        uploadAll(['p.gif', 'd.pdf']).then(([image, doc]) => {
          put(asset.id, { type: 'image', items: items(image) }).its('status').should('eq', 200);
          put(asset.id, { type: 'file', items: items(doc) }).its('status').should('eq', 200);
          put(asset.id, { type: 'file', items: [] }).its('status').should('eq', 200);
          listAttachments(asset.id).then((rows) => expect(rows.map((r) => [r.type, r.id])).to.deep.equal([['image', image]]));
        });
      });
    });

    it('rejects a malformed body and writes nothing; a path is not accepted in place of an id', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        const bad: unknown[] = [
          { items: [] },
          { type: 'nonsense', items: [] },
          { type: 'file' },
          { type: 'file', items: 'x' },
          { type: 'file', items: [{ path: '/uploads/x.pdf' }] },
          { type: 'file', items: [{ name: 'x.pdf', path: 'javascript:alert(1)' }] },
          { type: 'file', items: [{ id: '' }] },
          { type: 'file', items: [{ id: 42 }] },
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
          upload('x.pdf', key).then((id) => {
            put(asset.id, { type: 'file', items: items(id) }, key).its('status').should('eq', 403);
          });
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
          upload('x.pdf', key).then((id) => {
            put(asset.id, { type: 'file', items: items(id) }, key).its('status').should('eq', 200);
          });
        });
      });
    });
  });

  describe('organization isolation', () => {
    it('answers 404 for a record of a foreign organization and writes nothing', () => {
      cy.task<Asset[]>('db:populateCrAsset', 2).then(([own, foreign]) => {
        uploadAll(['seed.pdf', 'from-outside.pdf', 'inside.pdf']).then(([seed, outside, inside]) => {
          put(foreign.id, { type: 'file', items: items(seed) }).its('status').should('eq', 200);
          cy.task('db:createCrossOrgScenario', { entityName: 'cr_asset', entityId: foreign.id }).then(() => {
            put(foreign.id, { type: 'file', items: items(outside) }).its('status').should('eq', 404);
            put(foreign.id, { type: 'file', items: [] }).its('status').should('eq', 404);
            // The record of the caller's own organization is still reachable.
            put(own.id, { type: 'file', items: items(inside) }).its('status').should('eq', 200);
          });
        });
      });
    });

    it('refuses to take over an attachment of another record by naming its id', () => {
      cy.task<Asset[]>('db:populateCrAsset', 2).then(([mine, other]) => {
        upload('theirs.pdf').then((theirs) => {
          put(other.id, { type: 'file', items: items(theirs) }).its('status').should('eq', 200);
          put(mine.id, { type: 'file', items: items(theirs) }).its('status').should('eq', 404);
          listAttachments(mine.id).then((rows) => expect(rows).to.have.length(0));
          listAttachments(other.id).then((rows) => expect(rows.map((r) => r.id)).to.deep.equal([theirs]));
        });
      });
    });
  });

  describe('who can attach an upload', () => {
    it('refuses to attach a file another user uploaded, and the file stays unattached', () => {
      cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_asset',
          flags: { read: true, update: true },
          label: 'otheruploader',
          organizationId: asset.organization_id,
        }).then((otherKey) => {
          upload('others.pdf', otherKey).then((othersFile) => {
            // The caller holds update on the record, but the file is not theirs to attach.
            put(asset.id, { type: 'file', items: items(othersFile) }).its('status').should('eq', 404);
            listAttachments(asset.id).then((rows) => expect(rows).to.have.length(0));
            // Its uploader can.
            put(asset.id, { type: 'file', items: items(othersFile) }, otherKey).its('status').should('eq', 200);
          });
        });
      });
    });

    it('attaches an upload only once', () => {
      cy.task<Asset[]>('db:populateCrAsset', 2).then(([first, second]) => {
        upload('once.pdf').then((id) => {
          put(first.id, { type: 'file', items: items(id) }).its('status').should('eq', 200);
          put(second.id, { type: 'file', items: items(id) }).its('status').should('eq', 404);
        });
      });
    });
  });
});
