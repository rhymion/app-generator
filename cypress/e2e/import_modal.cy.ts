import { TEST_CREDENTIALS } from '../support/test-credentials';

const ENTITY      = 'user';
const LIST_PATH   = `/en/${ENTITY}`;
const IMPORT_API  = `/api/${ENTITY}/import`;
const SAMPLE_CSV  = Cypress.Buffer.from('name,image\nTest User,https://example.com/img.png');

describe('ImportModal UI', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');   // must include import:true (see prerequisite)
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((w) => { w.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('UI-1: Import button visible on import-eligible entity list page', () => {
    cy.visit(LIST_PATH);
    // user entity: import_can_create=false, import_can_update=true → 'Update via CSV'
    cy.get('button').contains('Update via CSV').should('be.visible');
  });

  it('UI-2: Dry-run success shows Preview OK and Confirm button', () => {
    cy.intercept('POST', IMPORT_API, {
      statusCode: 200,
      body: { summary: { total: 2, succeeded: 2, failed: 0, dryRun: true }, errors: [], confirmToken: 'mock-token' },
    }).as('dryRun');
    cy.visit(LIST_PATH);
    cy.get('button').contains('Update via CSV').click();
    cy.get('input[type="file"][aria-label="Choose CSV file"]').selectFile(
      { contents: SAMPLE_CSV, fileName: 'test.csv', mimeType: 'text/csv' },
      { force: true },
    );
    cy.get('button').contains('Preview changes').click();
    cy.wait('@dryRun');
    cy.contains('Preview OK').should('be.visible');
    cy.get('button').contains('Confirm & Import').should('be.visible');
  });

  it('UI-3: Dry-run with errors shows error table and hides Confirm button', () => {
    cy.intercept('POST', IMPORT_API, {
      statusCode: 200,
      body: {
        summary: { total: 1, succeeded: 0, failed: 1, dryRun: true },
        errors: [{ row: 2, code: 'NOT_FOUND', message: "role 'Editor' not found in role" }],
      },
    }).as('dryRunErr');
    cy.visit(LIST_PATH);
    cy.get('button').contains('Update via CSV').click();
    cy.get('input[type="file"][aria-label="Choose CSV file"]').selectFile(
      { contents: SAMPLE_CSV, fileName: 'err.csv', mimeType: 'text/csv' },
      { force: true },
    );
    cy.get('button').contains('Preview changes').click();
    cy.wait('@dryRunErr');
    cy.get('table[aria-label="import-errors"]').should('be.visible');
    cy.contains('NOT_FOUND').should('be.visible');
    cy.get('button').contains('Confirm & Import').should('not.exist');
  });

  it('UI-4: Full confirm flow shows Import complete', () => {
    cy.intercept('POST', IMPORT_API, (req) => {
      if (req.body.dryRun === true) {
        req.reply({ statusCode: 200, body: {
          summary: { total: 1, succeeded: 1, failed: 0, dryRun: true },
          errors: [],
          confirmToken: 'tok-abc',
        }});
      } else {
        req.reply({ statusCode: 200, body: {
          summary: { total: 1, succeeded: 1, failed: 0, dryRun: false },
          errors: [],
        }});
      }
    }).as('importReq');
    cy.visit(LIST_PATH);
    cy.get('button').contains('Update via CSV').click();
    cy.get('input[type="file"][aria-label="Choose CSV file"]').selectFile(
      { contents: SAMPLE_CSV, fileName: 'confirm.csv', mimeType: 'text/csv' },
      { force: true },
    );
    cy.get('button').contains('Preview changes').click();
    cy.wait('@importReq');
    cy.get('button').contains('Confirm & Import').click();
    cy.wait('@importReq');
    cy.contains('Import complete').should('be.visible');
  });
});
