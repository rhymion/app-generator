/// <reference types="cypress" />

/**
 * Custom Cypress commands
 */

// Login command
Cypress.Commands.add('login', (email, password) => {
    cy.session([email, password], () => {
        cy.visit('/login');
        cy.get('input[name="email"]').type(email);
        cy.get('input[name="password"]').type(password);
        cy.get('button[type="submit"]').click();
        cy.contains('Sign Out').should('be.visible');
    },
    { cacheAcrossSpecs: true }
    );
});

/**
 * Fill a labeled form field
 * Handles both associated labels (using 'for' attribute) and wrapped labels
 */
Cypress.Commands.add('fillField', (label: string, value: string) => {
  // First try to find label with 'for' attribute pointing to an input/textarea
  cy.get('body').then(($body) => {
    const $label = $body.find(`label:contains("${label}")`).first();
    const forAttr = $label.attr('for');
    
    if (forAttr) {
      // Use the 'for' attribute to find the specific input/textarea
      cy.get(`#${forAttr}`).type(value);
    } else {
      // Fall back to finding within parent (for wrapped labels)
      cy.contains('label', label).parent().find('input, textarea').first().type(value);
    }
  });
});

/**
 * Click a button by text
 */
Cypress.Commands.add('clickButton', (text: string) => {
  cy.contains('button', text).click();
});

// TypeScript definitions
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Custom command to login
       * @param email - User email
       * @param password - User password
       * @example cy.login('test@example.com', 'password123')
       */
      login(email: string, password: string): Chainable<void>;
      
      /**
       * Fill a form field by label
       * @param label - Label text
       * @param value - Value to type
       * @example cy.fillField('Name', 'John Doe')
       */
      fillField(label: string, value: string): Chainable<void>;
      
      /**
       * Click a button by text
       * @param text - Button text
       * @example cy.clickButton('Save')
       */
      clickButton(text: string): Chainable<void>;
    }
  }
}

export {};
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })
//
// declare global {
//   namespace Cypress {
//     interface Chainable {
//       login(email: string, password: string): Chainable<void>
//       drag(subject: string, options?: Partial<TypeOptions>): Chainable<Element>
//       dismiss(subject: string, options?: Partial<TypeOptions>): Chainable<Element>
//       visit(originalFn: CommandOriginalFn, url: string, options: Partial<VisitOptions>): Chainable<Element>
//     }
//   }
// }