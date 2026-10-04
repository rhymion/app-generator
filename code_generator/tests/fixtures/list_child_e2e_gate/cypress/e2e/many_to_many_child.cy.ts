import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

// lc_m2m_child: own editable pages, many-to-many with lc_m2m_parent. From the
// parent screen the user adds an existing child to the list and removes it from
// the list; removing never deletes the child record. Creating, editing or
// deleting the child record itself is not done from the parent screen.
describe('editable many-to-many list child', () => {
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
    cy.request({ method: 'POST', url: '/api/lc_m2m_child', headers, body: { name: 'M2m Kid' } })
      .its('body.id').then((kid) => {
        childId = kid;
        cy.request({
          method: 'POST', url: '/api/lc_m2m_parent', headers,
          body: { name: 'M2m Parent', kids_ids: [kid] },
        }).its('body.id').then((id) => { parentId = id; });
      });
  });

  it('shows the child on the parent screen and opens the child page', () => {
    cy.visit(`/en/lc_m2m_parent/view/${parentId}`);
    cy.contains('M2m Kid').should('be.visible');
    cy.visit(`/en/lc_m2m_child/view/${childId}`);
    cy.url().should('include', `/lc_m2m_child/view/${childId}`);
    cy.checkField('Name', 'M2m Kid');
  });

  it('removes the child from the list, keeps the record, and adds it back', () => {
    cy.visit(`/en/lc_m2m_parent/edit/${parentId}`);
    cy.contains('li', 'M2m Kid').find('button[aria-label="delete"]').click();
    cy.clickButton('Save');
    cy.url().should('not.include', '/lc_m2m_parent/edit');
    cy.visit(`/en/lc_m2m_parent/view/${parentId}`);
    cy.contains('M2m Kid').should('not.exist');

    // The child record itself is untouched: its page opens and the API returns it.
    cy.visit(`/en/lc_m2m_child/view/${childId}`);
    cy.checkField('Name', 'M2m Kid');
    cy.request({ url: `/api/lc_m2m_child/${childId}`, headers }).its('status').should('eq', 200);

    cy.visit(`/en/lc_m2m_parent/edit/${parentId}`);
    cy.clickButton('Add Kids');
    cy.get('div[role="dialog"]').find('input').type('M2m Kid');
    cy.get('.MuiAutocomplete-popper li').contains('M2m Kid').click();
    cy.get('div[role="dialog"]').find('button').contains('Add').click();
    cy.clickButton('Save');
    cy.url().should('not.include', '/lc_m2m_parent/edit');
    cy.visit(`/en/lc_m2m_parent/view/${parentId}`);
    cy.contains('M2m Kid').should('be.visible');
  });
});
