// Hand-written -- not part of the generated entity test set.
// POST /api/upload on the local-disk fallback (no Blob token): the client-supplied filename is
// never a path. A traversal filename is reduced to its last segment and the file lands inside
// public/uploads/, never outside it.
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

describe('API: upload keeps the stored file inside the uploads directory', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('stores a plain filename and serves it back', () => {
    upload('safe-note.txt').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.url).to.match(/^\/uploads\/[^/]+\/safe-note\.txt$/);
      cy.request(res.body.url).then((get) => {
        expect(get.status).to.eq(200);
        expect(get.body).to.contain('upload path safety');
      });
    });
  });

  it('does not write outside public/uploads for a ../ filename', () => {
    upload('../../../upload-escape-marker.txt').then((res) => {
      // Either refused, or stored under its last segment inside the uploads directory.
      if (res.status === 200) {
        expect(res.body.url).to.match(/^\/uploads\/[^/]+\/upload-escape-marker\.txt$/);
        expect(res.body.url).not.to.contain('..');
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
        expect(res.body.url).not.to.contain('..');
      } else {
        expect(res.status).to.be.oneOf([400, 422]);
      }
      cy.readFile('upload-escape-backslash.txt').should('not.exist');
    });
  });

  it('falls back to a generated name when the filename has no usable last segment', () => {
    upload('../').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.url).to.match(/^\/uploads\/[^/]+\/file$/);
    });
  });
});
