// Hand-written -- not part of the generated entity test set.
// GET /api/attachments/{id}: the only route that delivers a stored file, for an attachment owned through
// the `attachable` bridge of cr_asset (scoped by organization). Access follows the owning record, the same
// as its own detail route:
//   owner organization member with read permission      200
//   same organization, no read permission                404
//   user of another organization, even with read         404
// An upload that is not attached yet can only be read by the user who uploaded it.
import { TEST_API_KEY } from '../../support/test-credentials';

type Asset = { id: string; organization_id: string };

const BOUNDARY = '----attachmentsserveboundary';
const CONTENT = 'bridge attachment content';
const asKey = (key = TEST_API_KEY) => ({ 'X-API-Key': key });

function multipart(filename: string): string {
  return (
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/pdf\r\n\r\n` +
    `${CONTENT}\r\n` +
    `--${BOUNDARY}--\r\n`
  );
}

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

const read = (id: string, headers: Record<string, string> = asKey()) =>
  cy.request({ url: `/api/attachments/${id}`, headers, failOnStatusCode: false });

/** An attachment of a cr_asset record of the caller's organization. */
function attached(asset: Asset, name = 'contract.pdf'): Cypress.Chainable<string> {
  return upload(name).then((id) =>
    cy
      .request({
        method: 'PUT',
        url: `/api/cr_asset/${asset.id}/attachments`,
        headers: asKey(),
        body: { type: 'file', items: [{ id }] },
      })
      .then((res) => {
        expect(res.status).to.eq(200);
        return id;
      }),
  );
}

describe('API: attachments of a bridge owner are delivered through the authorized route', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('refuses a request without a credential', () => {
    cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
      attached(asset).then((id) => {
        cy.request({ url: `/api/attachments/${id}`, failOnStatusCode: false }).its('status').should('eq', 401);
      });
    });
  });

  it('delivers the file to an organization member who can read the record, under its original name', () => {
    cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
      attached(asset, 'signed contract.pdf').then((id) => {
        read(id).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body).to.eq(CONTENT);
          expect(res.headers['content-type']).to.contain('application/pdf');
          expect(res.headers['content-disposition']).to.match(/filename="signed contract\.pdf"/);
          expect(res.headers['x-content-type-options']).to.eq('nosniff');
        });
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_asset',
          flags: { read: true },
          label: 'memberreader',
          organizationId: asset.organization_id,
        }).then((key) => read(id, asKey(key)).its('status').should('eq', 200));
      });
    });
  });

  it('answers 404 to a member of the same organization who has no read permission on the record', () => {
    cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
      attached(asset).then((id) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_asset',
          flags: { read: false },
          label: 'memberdenied',
          organizationId: asset.organization_id,
        }).then((key) => read(id, asKey(key)).its('status').should('eq', 404));
      });
    });
  });

  it('answers 404 to a user of another organization, even one with read permission', () => {
    cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
      attached(asset).then((id) => {
        // No organizationId: the user belongs to no organization, so a different one from the record's.
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_asset',
          flags: { read: true },
          label: 'outsider',
        }).then((key) => read(id, asKey(key)).its('status').should('eq', 404));
      });
    });
  });

  it('lets only the uploader read an upload that is not attached yet', () => {
    cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
      upload('draft.pdf').then((id) => {
        read(id).its('status').should('eq', 200);
        // Same organization, read permission on the record, but not the uploader.
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_asset',
          flags: { read: true, update: true },
          label: 'notuploader',
          organizationId: asset.organization_id,
        }).then((key) => read(id, asKey(key)).its('status').should('eq', 404));
      });
    });
  });

  it('stops delivering a file once its attachment is removed from the record', () => {
    cy.task<Asset[]>('db:populateCrAsset', 1).then(([asset]) => {
      attached(asset).then((id) => {
        cy.request({
          method: 'PUT',
          url: `/api/cr_asset/${asset.id}/attachments`,
          headers: asKey(),
          body: { type: 'file', items: [] },
        }).its('status').should('eq', 200);
        read(id).its('status').should('eq', 404);
      });
    });
  });
});
