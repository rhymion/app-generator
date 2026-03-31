import { TEST_CREDENTIALS } from '../support/test-credentials';

describe('Authentication E2E Tests', () => {
  beforeEach(() => {
    // Reset and seed database before each test
    cy.task('db:reset');
    cy.task('db:seed');

    // Clear ALL session data including cy.session() cache
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();

    // Visit the home page
    cy.visit('/en/');

    // Now clear session storage (after page is loaded)
    cy.window().then((win) => {
      win.sessionStorage.clear();
    });
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
    cy.contains('Invalid credentials').should('be.visible');
  });

  it('should fail login with unknown email address', () => {
    cy.contains('Sign In').click();

    cy.get('input[name="email"]').type('unknown@example.com');
    cy.get('input[name="password"]').type('somepassword');

    cy.get('button[type="submit"]').click();

    cy.contains('Invalid credentials').should('be.visible');
  });

  it('should fail registration with existing email and correct password', () => {
    cy.visit('/en/register');

    cy.get('input[name="name"]').type('Test User');
    cy.get('input[name="email"]').type(TEST_CREDENTIALS.email);
    cy.get('input[name="password"]').type(TEST_CREDENTIALS.password);
    cy.get('input[name="confirm_password"]').type(TEST_CREDENTIALS.password);

    cy.get('button[type="submit"]').click();

    cy.contains('Email already in use').should('be.visible');
  });

  it('should fail registration with existing email and different password', () => {
    cy.visit('/en/register');

    cy.get('input[name="name"]').type('Test User');
    cy.get('input[name="email"]').type(TEST_CREDENTIALS.email);
    cy.get('input[name="password"]').type('differentpassword');
    cy.get('input[name="confirm_password"]').type('differentpassword');

    cy.get('button[type="submit"]').click();

    cy.contains('Email already in use').should('be.visible');
  });

  it('should succeed registration with new email and valid password', () => {
    cy.visit('/en/register');

    cy.get('input[name="name"]').type('New User');
    cy.get('input[name="email"]').type('newuser@example.com');
    cy.get('input[name="password"]').type('newpassword123');
    cy.get('input[name="confirm_password"]').type('newpassword123');

    cy.get('button[type="submit"]').click();

    // Should be redirected and logged in as the new user
    cy.contains('New User').should('be.visible');
  });
});
