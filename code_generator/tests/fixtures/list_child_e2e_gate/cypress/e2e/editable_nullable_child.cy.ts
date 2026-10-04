import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

// lc_edit_child: own editable pages, one-to-many, nullable link to the parent,
// plus a second FK (rel_par_id) to the parent's own model. The parent declares
// the child's label as [name, rel_par.name], so the label shows the child's name
// followed by the parent's name only when the second FK is fetched with the
// parent. lc_edit_sibling is a second list child of the same parent with its own
// FK to the same model.
//
// From the parent screen the user can add an existing child to the list and take
// one out of it (an association change). Creating, editing or deleting the child
// record itself is not done from the parent screen.
describe('editable list child with a nullable link', () => {
  let parentId: string;
  let childId: string;

  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.visit('/en/');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    cy.request({
      method: 'POST', url: '/api/lc_edit_parent', headers,
      body: { name: 'Edit Parent', kids_ids: [], sibs: [{ name: 'Sib A', related_id: null }] },
    }).its('body.id').then((id) => {
      parentId = id;
      cy.request({
        method: 'POST', url: '/api/lc_edit_child', headers,
        body: { name: 'Edit Kid', lc_edit_parent_id: id, rel_par_id: id },
      }).its('body.id').then((kid) => { childId = kid; });
    });
  });

  it('shows the child with the label built from its own FK to the parent model, and the sibling', () => {
    cy.visit(`/en/lc_edit_parent/view/${parentId}`);
    cy.contains('Edit Kid Edit Parent').should('be.visible');
    cy.contains('Sib A').should('be.visible');
    cy.visit(`/en/lc_edit_parent/edit/${parentId}`);
    cy.contains('Sib A').should('be.visible');
  });

  it('opens the child on its own page', () => {
    cy.visit(`/en/lc_edit_child/view/${childId}`);
    cy.url().should('include', `/lc_edit_child/view/${childId}`);
    cy.contains('Edit Kid').should('be.visible');
  });

  it('takes the child out of the list and adds it back; the child record stays', () => {
    cy.visit(`/en/lc_edit_parent/edit/${parentId}`);
    cy.contains('li', 'Edit Kid').find('button[aria-label="delete"]').click();
    cy.contains('li', 'Edit Kid').should('not.exist');
    cy.clickButton('Save');
    cy.url().should('not.include', '/lc_edit_parent/edit');

    cy.visit(`/en/lc_edit_parent/view/${parentId}`);
    cy.contains('Edit Kid').should('not.exist');
    // The child record itself is still there, on its own page and through the API.
    cy.visit(`/en/lc_edit_child/view/${childId}`);
    cy.contains('Edit Kid').should('be.visible');
    cy.request({ url: `/api/lc_edit_child/${childId}`, headers }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.name).to.eq('Edit Kid');
      expect(res.body.lc_edit_parent_id).to.eq(null);
    });

    // Add it back from the parent screen.
    cy.visit(`/en/lc_edit_parent/edit/${parentId}`);
    cy.clickButton('Add Kids');
    cy.get('div[role="dialog"]').find('input').type('Edit Kid');
    cy.get('.MuiAutocomplete-popper li').contains('Edit Kid').click();
    cy.get('div[role="dialog"]').find('button').contains('Add').click();
    cy.clickButton('Save');
    cy.url().should('not.include', '/lc_edit_parent/edit');
    cy.visit(`/en/lc_edit_parent/view/${parentId}`);
    cy.contains('Edit Kid Edit Parent').should('be.visible');
  });
});
