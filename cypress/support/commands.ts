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
  // Scope to <form> to avoid matching labels on the previous page during client-side
  // navigation (FormView renders real <input> elements with identical labels).
  // Use DOM traversal — not forAttr ID lookup — because MUI auto-generates input IDs
  // that can differ between SSR and hydration, making a cached ID stale.
  cy.get('form').contains('label', label).parent().find('input, textarea').first().type(value);
});

/**
 * Click a button or link by aria-label
 */
Cypress.Commands.add('clickButton', (text: string) => {
  cy.get(`button[aria-label="${text}"]`).click();
});

/**
 * Check a labeled form field value
 * Handles both associated labels (using 'for' attribute) and wrapped labels
 */
Cypress.Commands.add('checkField', (label: string, expectedValue: string) => {
  cy.contains('label', label).parent().find('input, textarea').first().should('have.value', expectedValue);
});

/**
 * Clear and re-fill a labeled form field (for editing existing values)
 */
Cypress.Commands.add('clearAndFillField', (label: string, value: string) => {
  cy.get('form').contains('label', label).parent().find('input, textarea').first().type('{selectall}' + value);
});

/**
 * Clear a labeled form field value entirely
 */
Cypress.Commands.add('clearField', (label: string) => {
  cy.get('form').contains('label', label).parent().find('input, textarea').first().type('{selectall}{backspace}');
});

/**
 * Select an option from MUI Autocomplete by label
 */
Cypress.Commands.add('selectAutocomplete', (label: string, optionText: string) => {
  cy.get('form').contains('label', label).parent().find('input').first().type('{selectall}' + optionText);
  cy.get('.MuiAutocomplete-popper li').contains(optionText).click();
});

/**
 * Clear MUI Autocomplete selection
 */
Cypress.Commands.add('clearAutocomplete', (label: string) => {
  cy.get('form').contains('label', label).parent().find('input').first().click();
  cy.get('form').contains('label', label).parent().find('button[aria-label="Clear"]').click();
});

/**
 * Set checkbox state by label
 */
Cypress.Commands.add('setCheckbox', (label: string, checked: boolean) => {
  cy.get('form').contains('label', label).parent().find('input[type="checkbox"]').then(($cb) => {
    if (checked && !$cb.is(':checked')) {
      cy.wrap($cb).check();
    } else if (!checked && $cb.is(':checked')) {
      cy.wrap($cb).uncheck();
    }
  });
});

/**
 * Fill MUI DateTimePicker by label using direct keyboard input.
 * Accepts dateString in "MM/DD/YYYY HH:MM AM|PM" format.
 *
 * MUI X v8 with enableAccessibleFieldDOMStructure=false renders a single <input>
 * with section-based keyboard handling. Typing digits auto-advances through each
 * section (MM → DD → YYYY → HH → MM → AM/PM), which works reliably in both
 * headed and headless Chromium without needing the calendar picker UI.
 */
Cypress.Commands.add('fillDateTime', (label: string, dateString: string) => {
  const parts = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!parts) throw new Error(`fillDateTime: Expected "MM/DD/YYYY HH:MM AM/PM", got "${dateString}"`);
  const [, month, day, year, hour, minute, ampm] = parts;
  const ampmChar = ampm.toUpperCase() === 'AM' ? 'a' : 'p';

  // Break the chain: MUI X re-renders the input on focus, detaching the original DOM node.
  // Re-querying after click ensures .type() gets the live element.
  cy.get('form').contains('label', label).parent().find('input').click();
  cy.get('form').contains('label', label).parent().find('input').type(month + day + year + hour + minute + ampmChar);
});

Cypress.Commands.add('fillDate', (label: string, dateString: string) => {
  const parts = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/i);
  if (!parts) throw new Error(`fillDate: Expected "MM/DD/YYYY", got "${dateString}"`);
  const [, month, day, year] = parts;

  cy.get('form').contains('label', label).parent().find('input').click();
  cy.get('form').contains('label', label).parent().find('input').type(month + day + year);
});

Cypress.Commands.add('fillTime', (label: string, dateString: string) => {
  const parts = dateString.match(/^(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!parts) throw new Error(`fillTime: Expected "HH:MM AM/PM", got "${dateString}"`);
  const [, hour, minute, ampm] = parts;
  const ampmChar = ampm.toUpperCase() === 'AM' ? 'a' : 'p';

  cy.get('form').contains('label', label).parent().find('input').click();
  cy.get('form').contains('label', label).parent().find('input').type(hour + minute + ampmChar);
});

/**
 * Clear MUI DateTimePicker by clicking its clear button.
 * Requires DateTimeWrapper to have clearable={true} on the field slot.
 */
Cypress.Commands.add('clearDateTime', (label: string) => {
  cy.get('form').contains('label', label).parent().find('button[title="Clear"]').click();
});

/**
 * Select DataGrid rows by checkbox (0-based indices)
 */
Cypress.Commands.add('selectDataGridRows', (indices: number[]) => {
  indices.forEach((i) => {
    cy.get(`div[role="row"][data-rowindex="${i}"]`).find('input[type="checkbox"]').check();
  });
});

// TypeScript definitions
declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>;
      fillField(label: string, value: string): Chainable<void>;
      clickButton(text: string): Chainable<void>;
      checkField(label: string, expectedValue: string): Chainable<void>;
      clearAndFillField(label: string, value: string): Chainable<void>;
      clearField(label: string): Chainable<void>;
      selectAutocomplete(label: string, optionText: string): Chainable<void>;
      clearAutocomplete(label: string): Chainable<void>;
      setCheckbox(label: string, checked: boolean): Chainable<void>;
      fillDateTime(label: string, dateString: string): Chainable<void>;
      fillDate(label: string, dateString: string): Chainable<void>;
      fillTime(label: string, dateString: string): Chainable<void>;
      clearDateTime(label: string): Chainable<void>;
      selectDataGridRows(indices: number[]): Chainable<void>;
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