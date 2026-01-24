// Example Cypress test with database reset
describe('DB Table E2E Tests', () => {
  beforeEach(() => {
    // Reset database before each test
    cy.task('db:reset');
    cy.task('db:seed');
    
    // Visit the page
    cy.visit('/db_table');
  });

  it('should display test table', () => {
    cy.contains('test_table').should('be.visible');
  });

  it('should create a new table', () => {
    cy.contains('Add New').click();
    cy.get('input[name="name"]').type('new_test_table');
    cy.get('input[name="description"]').type('New test description');
    
    // Add a field
    cy.contains('Add Field').click();
    // ... rest of test
    
    cy.contains('Save').click();
    cy.contains('new_test_table').should('be.visible');
  });
});
