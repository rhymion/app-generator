import { TEST_CREDENTIALS } from '../support/test-credentials';
import { fillDataGridRow } from '../support/datagrid-helpers';

// Hand-written regression guard for x-uri-kind: link (cmd_771). The
// generator's form_upsert_context()/form_view_context() previously
// categorized a format:uri field into cats['link_uri'] (build_context.py)
// but never rendered an input for it in FormUpsert.tsx, and rendered its
// read-only FormView as an <img>-based ImageDisplay instead of a clickable
// AppFieldExternalLink — the field could never be set via the UI, and on
// every edit the missing FormData entry let service.ts silently overwrite
// (erase) any existing value. dashboard.source_url is x-uri-kind: link.
// pytest (code_generator/tests/test_form_upsert.py::TestUriKindLinkField*)
// covers the generator-context level; this spec proves the actual rendered
// browser behavior end to end.

describe('dashboard.source_url (x-uri-kind: link) input wiring and data-loss guard', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('renders an input for the link field, saves it, and shows it as a clickable external link on view', () => {
    const url = 'https://example.com/report/1';
    cy.visit('/en/dashboard');
    cy.clickButton('Create New Dashboard');
    cy.url().should('include', '/dashboard/new');
    cy.fillField('Name', 'Link Field Test Dashboard');
    // The bug: before the fix, no input exists for a link field, so this
    // fillField would time out finding the labeled input at all.
    cy.fillField('Source URL', url);
    cy.clickButton('Add Widgets');
    fillDataGridRow(0, { name: 'W1', entity_name: 'Entity', group_by_field: 'Field' }, true, 'Widgets');
    cy.clickButton('Save');
    cy.url().should('include', '/dashboard');
    cy.url().should('not.include', '/dashboard/');

    cy.contains('Link Field Test Dashboard').click();
    cy.url().should('include', '/dashboard/view');
    // Read-only view must render a clickable external link, not an <img>.
    cy.contains('Source URL').parent().find('a').should('have.attr', 'href', url).and('have.text', url);
    cy.contains('Source URL').parent().find('img').should('not.exist');
  });

  it('does not silently wipe the link field value when only another field is edited', () => {
    const url = 'https://example.com/report/2';
    cy.visit('/en/dashboard');
    cy.clickButton('Create New Dashboard');
    cy.fillField('Name', 'Data Loss Guard Dashboard');
    cy.fillField('Source URL', url);
    cy.clickButton('Add Widgets');
    fillDataGridRow(0, { name: 'W1', entity_name: 'Entity', group_by_field: 'Field' }, true, 'Widgets');
    cy.clickButton('Save');

    // Edit WITHOUT touching Source URL — only change Name.
    cy.contains('Data Loss Guard Dashboard').click();
    cy.get('a[aria-label="Edit"]').click();
    cy.url().should('include', '/dashboard/edit');
    // The edit form's Source URL input must already be pre-filled with the
    // existing value (proves the input is wired to src, not just present).
    cy.checkField('Source URL', url);
    cy.clearAndFillField('Name', 'Data Loss Guard Dashboard Renamed');
    cy.clickButton('Save');

    cy.contains('Data Loss Guard Dashboard Renamed').click();
    cy.url().should('include', '/dashboard/view');
    // Core data-loss assertion: the untouched link field must still hold
    // its original value, not have been overwritten to null/empty.
    cy.contains('Source URL').parent().find('a').should('have.attr', 'href', url).and('have.text', url);
  });
});
