import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/user';
const EXPORT_PATH = `${API_BASE}/export`;
const IMPORT_PATH = `${API_BASE}/import`;

// Splits an export line into fields. None of the values used in this suite
// contain a comma, quote, or newline, so a plain split is sufficient (the
// full RFC 4180 quoting/escaping behavior is covered by user.cy.ts N1-N8).
function splitCsvLine(line: string): string[] {
  return line.split(',');
}

describe('API: CSV export/import round-trip (cmd_328 batch3, test9)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('T9-A: export -> edit a field -> import -> the DB reflects the change', () => {
    cy.task<{ id: string; name: string }>('db:createUserWithName', {
      name: '__rt_test__',
      image: 'https://example.com/before.png',
    }).then((record) => {
      cy.request({ url: EXPORT_PATH }).then((exportRes) => {
        const body = exportRes.body as string;
        const lines = body.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l.length > 0);
        const header = splitCsvLine(lines[0]);
        const nameIdx = header.indexOf('name');
        const imageIdx = header.indexOf('image');
        const row = lines.slice(1).find((l) => splitCsvLine(l)[nameIdx] === '__rt_test__');
        expect(row, 'exported row for __rt_test__').to.exist;
        const fields = splitCsvLine(row!);
        fields[imageIdx] = 'https://example.com/after.png';
        const csv = `${lines[0]}\r\n${fields.join(',')}`;

        cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true } }).then((dryRes) => {
          expect(dryRes.body.errors).to.have.length(0);
          const token = dryRes.body.confirmToken;
          cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: false, confirmToken: token } }).then(
            (commitRes) => {
              expect(commitRes.body.summary.succeeded).to.eq(1);
            },
          );
        });
      });
      cy.request({ url: `${API_BASE}/${record.id}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        expect(res.body.image).to.eq('https://example.com/after.png');
      });
    });
  });

  // NOTE: cy.request's response body already has its leading BOM stripped by the
  // time test code sees it (verified: the raw HTTP bytes from GET /api/user/export
  // do start with EF BB BF, but `exportRes.body` here does not) — so a round-trip
  // export -> import cannot observe the BOM at this layer. Testing the route's own
  // strip logic directly instead: a hand-crafted CSV with a literal leading BOM,
  // exactly matching what export actually emits (api_export_route.ts.jinja2), must
  // not produce MISSING_COLUMN — proving `csvRaw.charCodeAt(0) === 0xfeff ? csvRaw.slice(1)
  // : csvRaw` (api_import_route.ts.jinja2) strips it before header parsing.
  it('T9-B: a leading BOM in the CSV (as export emits) is stripped before header parsing', () => {
    cy.task('db:createUserWithName', { name: '__rt_bom_test__', image: 'https://example.com/bom.png' });
    const csv = '\uFEFFname,image\n__rt_bom_test__,https://example.com/bom2.png';
    cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true } }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.errors).to.have.length(0);
    });
  });

  it('T9-C: a formula-trigger value survives export -> import (tab prefix added, then stripped)', () => {
    cy.task<{ id: string }>('db:createUserWithName', { name: '=SA2test', image: 'https://example.com/before_sa2.png' }).then(
      (record) => {
        cy.request({ url: EXPORT_PATH }).then((exportRes) => {
          const body = exportRes.body as string;
          expect(body).to.include('\t=SA2test');
          const lines = body.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l.length > 0);
          const header = splitCsvLine(lines[0]);
          const nameIdx = header.indexOf('name');
          const imageIdx = header.indexOf('image');
          const row = lines.slice(1).find((l) => splitCsvLine(l)[nameIdx] === '\t=SA2test');
          expect(row, 'exported row for =SA2test').to.exist;
          const fields = splitCsvLine(row!);
          fields[imageIdx] = 'https://example.com/after_sa2.png';
          const csv = `${lines[0]}\r\n${fields.join(',')}`;

          cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true } }).then((dryRes) => {
            expect(dryRes.body.errors).to.have.length(0);
            const token = dryRes.body.confirmToken;
            cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: false, confirmToken: token } }).then(
              (commitRes) => {
                expect(commitRes.body.summary.succeeded).to.eq(1);
              },
            );
          });
        });
        cy.request({ url: `${API_BASE}/${record.id}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
          expect(res.body.name).to.eq('=SA2test');
          expect(res.body.image).to.eq('https://example.com/after_sa2.png');
        });
      },
    );
  });

  it('T9-D: dryRun=true does not require a confirmToken and returns one', () => {
    cy.task('db:createUserWithName', { name: '__rt_dryrun_test__', image: 'https://example.com/x.png' });
    const csv = 'name,image\n__rt_dryrun_test__,https://example.com/y.png';
    cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true } }).then((res) => {
      expect(res.body.confirmToken).to.be.a('string');
      expect(res.body.errors).to.have.length(0);
    });
  });
});
