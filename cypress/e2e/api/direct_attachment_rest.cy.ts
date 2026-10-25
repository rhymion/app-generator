// Hand-written -- not part of the generated entity test set.
// The REST side of a direct attachment field (x-relationship type: direct), exercised on user.image:
//   POST /api/upload             stores the file and answers with the id of the attachment it created
//   POST /api/attachment/direct  prepares that attachment (by id) for the field
//   PUT  /api/user/:id           links the attachment by id
// The first two accept a mobile access token as well as the browser session. Any authenticated caller may
// store a file; only its uploader can prepare or link it, and the entity's own update permission decides
// whether the link is saved.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

const UPLOAD_URL = '/api/upload';
const DIRECT_URL = '/api/attachment/direct';

type TokenPair = { access_token: string };

function mobileToken(email: string, password: string): Cypress.Chainable<string> {
  return cy
    .request('POST', '/api/mobile/auth/token', { email, password })
    .then((res) => (res.body as TokenPair).access_token);
}

const BOUNDARY = '----directattachmentboundary';

/** A multipart body by hand: cy.request has no FormData support. */
function multipart(filename: string, contentType: string, content: string): string {
  return (
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    `${content}\r\n` +
    `--${BOUNDARY}--\r\n`
  );
}

function upload(headers: Record<string, string>, body = multipart('medical-note.txt', 'text/plain', 'hello')) {
  return cy.request({
    method: 'POST',
    url: UPLOAD_URL,
    headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
    body,
    failOnStatusCode: false,
  });
}

function createRow(headers: Record<string, string>, body: unknown) {
  return cy.request({ method: 'POST', url: DIRECT_URL, headers, body, failOnStatusCode: false });
}

function sessionUserId(): Cypress.Chainable<string> {
  return cy
    .request({ url: '/api/user', headers: { 'X-API-Key': TEST_API_KEY } })
    .then((res) => {
      // The user list does not expose email, so the seeded user is found by its (unique) name.
      const row = (res.body.rows as { id: string; name: string }[]).find((u) => u.name === TEST_CREDENTIALS.name);
      expect(row, 'test user').to.exist;
      return row!.id;
    });
}

describe('API: direct attachment upload and row creation accept a mobile access token', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('stores a file for a mobile token holder', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      upload({ Authorization: `Bearer ${token}` }).then((res) => {
        expect(res.status).to.eq(200);
        // The response names the attachment, never a location.
        expect(res.body).to.have.keys(['id', 'name']);
        expect(res.body.id).to.be.a('string').and.not.be.empty;
        expect(res.body.name).to.eq('medical-note.txt');
      });
    });
  });

  it('refuses an upload with no credential, a tampered token or an unsupported type', () => {
    upload({}).its('status').should('eq', 401);
    upload({ Authorization: 'Bearer aaa.bbb.ccc' }).its('status').should('eq', 401);
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      upload({ Authorization: `Bearer ${token}` }, multipart('run.sh', 'application/x-sh', 'echo hi'))
        .its('status')
        .should('eq', 400);
    });
  });

  it('prepares an uploaded file for the field and shows it, decrypted, on the linked record', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      const headers = { Authorization: `Bearer ${token}` };
      upload(headers).then((uploaded) => {
        createRow(headers, { id: uploaded.body.id, type: 'file' }).then((res) => {
          expect(res.status).to.eq(201);
          expect(res.body).to.have.keys(['id', 'name', 'path', 'type']);
          expect(res.body.name).to.eq('medical-note.txt');
          // The file is delivered from its authorized route, keyed by the attachment id.
          expect(res.body.path).to.eq(`/api/attachments/${uploaded.body.id}`);
          const attachmentId = res.body.id as string;

          sessionUserId().then((userId) => {
            cy.request({
              method: 'PUT',
              url: `/api/user/${userId}`,
              headers,
              body: { name: TEST_CREDENTIALS.name, image_id: attachmentId },
              failOnStatusCode: false,
            }).its('status').should('eq', 200);
            cy.request({ url: `/api/user/${userId}`, headers }).then((detail) => {
              expect(detail.body.image).to.include({ id: attachmentId, name: 'medical-note.txt', path: `/api/attachments/${attachmentId}` });
              // The stored name is encrypted; the REST detail never carries the ciphertext or its IV.
              expect(detail.body.image).not.to.have.any.keys('encrypted_original_name', 'name_iv');
            });
          });
        });
      });
    });
  });

  it('refuses row creation with no credential or a tampered token', () => {
    const body = { id: 'some-attachment', type: 'file' };
    createRow({}, body).its('status').should('eq', 401);
    createRow({ Authorization: 'Bearer aaa.bbb.ccc' }, body).its('status').should('eq', 401);
  });

  it('refuses a malformed request before it reaches the database', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      const headers = { Authorization: `Bearer ${token}` };
      upload(headers).then((uploaded) => {
        const ok = { id: uploaded.body.id, type: 'file' };
        for (const bad of [
          { ...ok, type: 'executable' },
          { ...ok, type: 7 },
          { ...ok, id: '' },
          { ...ok, id: 'x'.repeat(65) },
          { ...ok, id: 42 },
          // A path or URL is not accepted in place of an id.
          { type: 'file', path: '/uploads/x/a.txt' },
          { type: 'file', name: 'a.txt', path: 'javascript:alert(1)' },
        ]) {
          createRow(headers, bad).its('status').should('eq', 400);
        }
        cy.request({ method: 'POST', url: DIRECT_URL, headers: { ...headers, 'Content-Type': 'text/plain' }, body: 'not json', failOnStatusCode: false })
          .its('status')
          .should('eq', 400);
      });
    });
  });

  it('answers 404 for an attachment that does not exist', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      createRow({ Authorization: `Bearer ${token}` }, { id: 'no-such-attachment', type: 'file' }).its('status').should('eq', 404);
    });
  });

  it('lets only the uploader prepare or link a file: another user gets 404 and the file stays unlinked', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((ownerToken) => {
      upload({ Authorization: `Bearer ${ownerToken}` }).then((uploaded) => {
        cy.task<string>('db:createSessionUserWithPermission', {
          entityName: 'user',
          flags: { read: true, update: true },
          label: 'directattachmentother',
        }).then((email) => {
          mobileToken(email, TEST_CREDENTIALS.password).then((otherToken) => {
            const other = { Authorization: `Bearer ${otherToken}` };
            createRow(other, { id: uploaded.body.id, type: 'file' }).its('status').should('eq', 404);
            // Naming the id directly in the entity update is refused as well.
            cy.request({ url: '/api/user', headers: { 'X-API-Key': TEST_API_KEY } }).then((list) => {
              const row = (list.body.rows as { id: string; email?: string; name: string }[]).find((u) => u.name !== TEST_CREDENTIALS.name);
              expect(row, 'other user').to.exist;
              cy.request({
                method: 'PUT',
                url: `/api/user/${row!.id}`,
                headers: other,
                body: { image_id: uploaded.body.id },
                failOnStatusCode: false,
              }).its('status').should('be.oneOf', [400, 422, 404]);
            });
          });
        });
      });
    });
  });

  it('leaves the link to the entity: a holder without update permission can store a file but not link it', () => {
    cy.task<string>('db:createSessionUserWithPermission', {
      entityName: 'user',
      flags: { read: true, update: false },
      label: 'directattachmentnolink',
    }).then((email) => {
      mobileToken(email, TEST_CREDENTIALS.password).then((token) => {
        const headers = { Authorization: `Bearer ${token}` };
        upload(headers).then((uploaded) => {
          createRow(headers, { id: uploaded.body.id, type: 'file' }).then((res) => {
            expect(res.status).to.eq(201);
            sessionUserId().then((userId) => {
              cy.request({
                method: 'PUT',
                url: `/api/user/${userId}`,
                headers,
                body: { image_id: res.body.id },
                failOnStatusCode: false,
              }).its('status').should('eq', 403);
            });
          });
        });
      });
    });
  });
});
