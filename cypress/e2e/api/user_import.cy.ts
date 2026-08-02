import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/user';
const IMPORT_PATH = `${API_BASE}/import`;

describe('API: User CSV Import (cmd_328 batch1)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  // test1: new:false entity (user) → CREATE row → Tier1 reject, DB unchanged
  it('test1: rejects a CREATE row with ENTITY_IMPORT_CREATE_NOT_SUPPORTED and does not write', () => {
    const csv = 'name,image\n__nonexistent_user__,https://example.com/x.png';
    cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true } }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.errors).to.have.length(1);
      expect(res.body.errors[0].code).to.eq('ENTITY_IMPORT_CREATE_NOT_SUPPORTED');
      expect(res.body.summary.failed).to.eq(1);
      expect(res.body.summary.succeeded).to.eq(0);
    });
    cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
      const names = (res.body.rows as Array<{ name: string }>).map((r) => r.name);
      expect(names).to.not.include('__nonexistent_user__');
    });
  });

  // test3: two existing rows share the import key → MULTI_MATCH
  it('test3: rejects a row whose import key matches more than one existing record', () => {
    cy.task('db:createUserWithName', { name: 'dup_user' });
    cy.task('db:createUserWithName', { name: 'dup_user' });
    const csv = 'name,image\ndup_user,https://example.com/new.png';
    cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true } }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.errors).to.have.length(1);
      expect(res.body.errors[0].code).to.eq('MULTI_MATCH');
    });
  });

  // test7: dry-run leaves the DB untouched; commit requires a valid confirmToken
  describe('test7: dry-run and confirmToken', () => {
    it('7a: dryRun=true returns a confirmToken and does not modify the DB', () => {
      cy.task<{ id: string }>('db:createUserWithName', { name: 'dryrun_user', image: 'https://example.com/old.png' }).then((record) => {
        const csv = 'name,image\ndryrun_user,https://example.com/new.png';
        cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true } }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.errors).to.have.length(0);
          expect(res.body.confirmToken).to.be.a('string');
          expect(res.body.summary.dryRun).to.eq(true);
        });
        cy.request({ url: `${API_BASE}/${record.id}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
          expect(res.body.image).to.eq('https://example.com/old.png');
        });
      });
    });

    it('7b: dryRun=false without a confirmToken is rejected with 400 INVALID_CONFIRM_TOKEN', () => {
      cy.task('db:createUserWithName', { name: 'nocommit_user' });
      const csv = 'name,image\nnocommit_user,https://example.com/new.png';
      cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: false }, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body.errors[0].code).to.eq('INVALID_CONFIRM_TOKEN');
      });
    });

    it('7c: dryRun=false with a valid confirmToken commits the update', () => {
      cy.task<{ id: string }>('db:createUserWithName', { name: 'commit_user', image: 'https://example.com/old.png' }).then((record) => {
        const csv = 'name,image\ncommit_user,https://example.com/new.png';
        cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true } }).then((dryRes) => {
          const token = dryRes.body.confirmToken;
          cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: false, confirmToken: token } }).then((commitRes) => {
            expect(commitRes.status).to.eq(200);
            expect(commitRes.body.errors).to.have.length(0);
            expect(commitRes.body.summary.succeeded).to.eq(1);
          });
        });
        cy.request({ url: `${API_BASE}/${record.id}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
          expect(res.body.image).to.eq('https://example.com/new.png');
        });
      });
    });

    it('7d: a malformed confirmToken is rejected, not treated as valid', () => {
      cy.task('db:createUserWithName', { name: 'crosstoken_user' });
      const csv = 'name,image\ncrosstoken_user,https://example.com/new.png';
      cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: false, confirmToken: 'not-a-real-token' }, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body.errors[0].code).to.eq('INVALID_CONFIRM_TOKEN');
      });
    });
  });

  // test8: request-size guards
  describe('test8: size limits', () => {
    it('8a: more than 5000 rows is rejected with 400 TOO_MANY_ROWS', () => {
      const header = 'name,image';
      const rows = Array.from({ length: 5001 }, (_, i) => `row_${i},x.png`).join('\n');
      const csv = `${header}\n${rows}`;
      cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true }, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body.errors[0].code).to.eq('TOO_MANY_ROWS');
      });
    });

    it('8b: a payload over 10MB is rejected with 400 FILE_TOO_LARGE', () => {
      const bigValue = 'x'.repeat(11 * 1024 * 1024);
      const csv = `name,image\nbig_user,${bigValue}`;
      cy.request({ method: 'POST', url: IMPORT_PATH, body: { csv, dryRun: true }, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body.errors[0].code).to.eq('FILE_TOO_LARGE');
      });
    });
  });
});
