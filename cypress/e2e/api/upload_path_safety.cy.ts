// Hand-written -- not part of the generated entity test set.
// POST /api/upload on the local-disk fallback (no Blob token): the client-supplied filename is
// never a path. The stored object gets a random key with nothing from the filename in it; a traversal
// filename is reduced to its last segment for display, and nothing is written outside the storage
// directory (which is not under public/).
import { TEST_API_KEY } from '../../support/test-credentials';

const UPLOAD_URL = '/api/upload';
const BOUNDARY = '----uploadpathsafetyboundary';

function multipart(filename: string, content: string): string {
  return (
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `${content}\r\n` +
    `--${BOUNDARY}--\r\n`
  );
}

function upload(filename: string, content = 'upload path safety') {
  return cy.request({
    method: 'POST',
    url: UPLOAD_URL,
    headers: { 'X-API-Key': TEST_API_KEY, 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
    body: multipart(filename, content),
    failOnStatusCode: false,
  });
}

describe('API: upload stores the file under an opaque key and never as a path', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('answers with an attachment id and serves the file back to its uploader through the authorized route', () => {
    upload('safe-note.txt').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body).to.have.keys(['id', 'name']);
      expect(res.body.name).to.eq('safe-note.txt');
      cy.request({ url: `/api/attachments/${res.body.id}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((get) => {
        expect(get.status).to.eq(200);
        expect(get.body).to.contain('upload path safety');
        // The decrypted original name is delivered as the download name; the stored key is not.
        expect(get.headers['content-disposition']).to.contain('safe-note.txt');
        expect(get.headers['x-content-type-options']).to.eq('nosniff');
        expect(get.headers['cache-control']).to.contain('no-store');
      });
    });
  });

  it('never exposes a file by a public path: /uploads and /api/uploads are gone', () => {
    upload('public-probe.txt').then((res) => {
      expect(res.status).to.eq(200);
      for (const url of ['/uploads/public-probe.txt', '/api/uploads/public-probe.txt', '/api/gcs/public-probe.txt']) {
        cy.request({ url, failOnStatusCode: false }).its('status').should('eq', 404);
      }
    });
  });

  it('does not write outside the storage directory for a ../ filename', () => {
    upload('../../../upload-escape-marker.txt').then((res) => {
      // Either refused, or stored under a random key with the last segment as its display name.
      if (res.status === 200) {
        expect(res.body.name).to.eq('upload-escape-marker.txt');
      } else {
        expect(res.status).to.be.oneOf([400, 422]);
      }
      cy.readFile('upload-escape-marker.txt').should('not.exist');
      cy.readFile('public/upload-escape-marker.txt').should('not.exist');
    });
  });

  it('does not treat a backslash-separated traversal filename as a path', () => {
    upload('..\\..\\..\\upload-escape-backslash.txt').then((res) => {
      if (res.status === 200) {
        expect(res.body.name).to.eq('upload-escape-backslash.txt');
      } else {
        expect(res.status).to.be.oneOf([400, 422]);
      }
      cy.readFile('upload-escape-backslash.txt').should('not.exist');
    });
  });

  it('refuses a filename with no usable last segment (it has no allow-listed extension)', () => {
    upload('../').then((res) => {
      expect(res.status).to.eq(400);
    });
  });

  it('refuses a file whose extension is not allow-listed even when the declared type is', () => {
    upload('page.html').then((res) => {
      expect(res.status).to.eq(400);
    });
  });
});
