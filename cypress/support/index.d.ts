/// <reference types="cypress" />

declare namespace Cypress {
  interface Chainable<_Subject = any> {
    /**
     * Custom command to log in a user.
     * @example cy.login('username', 'password')
     */
    login(email: string, password: string): Chainable<any>; 
  }
}
