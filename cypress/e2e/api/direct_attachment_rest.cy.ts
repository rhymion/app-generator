// Hand-written -- not part of the generated entity test set.
// The REST side of a direct attachment field (x-relationship type: direct), exercised on user.image:
//   POST /api/upload             stores the file
//   POST /api/attachment/direct  creates the standalone attachment row for it
//   PUT  /api/user/:id           links the row by id
// The first two accept a mobile access token as well as the browser session. Authorization is unchanged:
// any authenticated caller may store a file and create the (still unlinked) row, and the entity's own
// update permission decides whether the link is saved.
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
        expect(res.body.url).to.be.a('string').and.not.be.empty;
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

  it('creates the attachment row for an uploaded file and shows it, decrypted, on the linked record', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      const headers = { Authorization: `Bearer ${token}` };
      upload(headers).then((uploaded) => {
        createRow(headers, { name: 'medical-note.txt', path: uploaded.body.url, type: 'file' }).then((res) => {
          expect(res.status).to.eq(201);
          expect(res.body).to.have.keys(['id', 'name', 'path', 'type']);
          expect(res.body.name).to.eq('medical-note.txt');
          expect(res.body.path).to.eq(uploaded.body.url);
          const attachmentId = res.body.id as string;

          sessionUserId().then((userId) => {
            cy.request({
              method: 'PUT',
              url: `/api/user/${userId}`,
              headers,
              body: { image_id: attachmentId },
              failOnStatusCode: false,
            }).its('status').should('eq', 200);
            cy.request({ url: `/api/user/${userId}`, headers }).then((detail) => {
              expect(detail.body.image).to.include({ id: attachmentId, name: 'medical-note.txt' });
              // The stored name is encrypted; the REST detail never carries the ciphertext or its IV.
              expect(detail.body.image).not.to.have.any.keys('encrypted_original_name', 'name_iv');
            });
          });
        });
      });
    });
  });

  it('refuses row creation with no credential or a tampered token', () => {
    const body = { name: 'a.txt', path: '/uploads/x/a.txt', type: 'file' };
    createRow({}, body).its('status').should('eq', 401);
    createRow({ Authorization: 'Bearer aaa.bbb.ccc' }, body).its('status').should('eq', 401);
  });

  it('refuses a malformed row before it reaches the database', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      const headers = { Authorization: `Bearer ${token}` };
      const ok = { name: 'a.txt', path: '/uploads/x/a.txt', type: 'file' };
      for (const bad of [
        { ...ok, type: 'executable' },
        { ...ok, type: 7 },
        { ...ok, name: '' },
        { ...ok, name: 'x'.repeat(256) },
        { ...ok, path: 'javascript:alert(1)' },
        { ...ok, path: '//evil.example/a.txt' },
        { ...ok, path: undefined },
      ]) {
        createRow(headers, bad).its('status').should('eq', 400);
      }
      cy.request({ method: 'POST', url: DIRECT_URL, headers: { ...headers, 'Content-Type': 'text/plain' }, body: 'not json', failOnStatusCode: false })
        .its('status')
        .should('eq', 400);
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
          createRow(headers, { name: 'medical-note.txt', path: uploaded.body.url, type: 'file' }).then((res) => {
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
