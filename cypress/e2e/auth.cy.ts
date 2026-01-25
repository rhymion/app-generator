import { TEST_CREDENTIALS } from '../support/test-credentials';

describe('Authentication E2E Tests', () => {
  beforeEach(() => {
    // Reset and seed database before each test
    cy.task('db:reset');
    cy.task('db:seed');
    
    // Visit the home page
    cy.visit('/');
  });

  it('should login with test credentials', () => {
    // Click sign in
    cy.contains('Sign In').click();
    
    // Fill in login form with test credentials
    cy.get('input[name="email"]').type(TEST_CREDENTIALS.email);
    cy.get('input[name="password"]').type(TEST_CREDENTIALS.password);
    
    // Submit login
    cy.get('button[type="submit"]').click();
    
    // Should be logged in
    cy.contains(TEST_CREDENTIALS.name).should('be.visible');
  });

  it('should fail login with wrong password', () => {
    cy.contains('Sign In').click();
    
    cy.get('input[name="email"]').type(TEST_CREDENTIALS.email);
    cy.get('input[name="password"]').type('wrongpassword');
    
    cy.get('button[type="submit"]').click();
    
    // Should show error
    cy.contains(/invalid|incorrect|wrong/i).should('be.visible');
  });
});
