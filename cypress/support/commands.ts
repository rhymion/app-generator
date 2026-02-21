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

/**
 * Check a labeled form field value
 * Handles both associated labels (using 'for' attribute) and wrapped labels
 */
Cypress.Commands.add('checkField', (label: string, expectedValue: string) => {
  cy.get('body').then(($body) => {
    const $label = $body.find(`label:contains("${label}")`).first();
    const forAttr = $label.attr('for');

    if (forAttr) {
      cy.get(`#${forAttr}`).should('have.value', expectedValue);
    } else {
      cy.contains('label', label).parent().find('input, textarea').first().should('have.value', expectedValue);
    }
  });
});

/**
 * Clear and re-fill a labeled form field (for editing existing values)
 */
Cypress.Commands.add('clearAndFillField', (label: string, value: string) => {
  cy.get('body').then(($body) => {
    const $label = $body.find(`label:contains("${label}")`).first();
    const forAttr = $label.attr('for');

    if (forAttr) {
      cy.get(`#${forAttr}`).clear().type(value);
    } else {
      cy.contains('label', label).parent().find('input, textarea').first().clear().type(value);
    }
  });
});

/**
 * Clear a labeled form field value entirely
 */
Cypress.Commands.add('clearField', (label: string) => {
  cy.get('body').then(($body) => {
    const $label = $body.find(`label:contains("${label}")`).first();
    const forAttr = $label.attr('for');

    if (forAttr) {
      cy.get(`#${forAttr}`).clear();
    } else {
      cy.contains('label', label).parent().find('input, textarea').first().clear();
    }
  });
});

/**
 * Select an option from MUI Autocomplete by label
 */
Cypress.Commands.add('selectAutocomplete', (label: string, optionText: string) => {
  cy.contains('label', label).parent().find('input').first().clear().type(optionText);
  cy.get('.MuiAutocomplete-popper li').contains(optionText).click();
});

/**
 * Clear MUI Autocomplete selection
 */
Cypress.Commands.add('clearAutocomplete', (label: string) => {
  cy.contains('label', label).parent().find('button[aria-label="Clear"]').click();
});

/**
 * Set checkbox state by label
 */
Cypress.Commands.add('setCheckbox', (label: string, checked: boolean) => {
  cy.contains('label', label).parent().find('input[type="checkbox"]').then(($cb) => {
    if (checked && !$cb.is(':checked')) {
      cy.wrap($cb).check();
    } else if (!checked && $cb.is(':checked')) {
      cy.wrap($cb).uncheck();
    }
  });
});

// Full month names — used to build aria-labels for year/month/day calendar buttons
const PICKER_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Fill MUI DateTimePicker by label using the calendar UI.
 * Accepts dateString in "MM/DD/YYYY HH:MM AM|PM" format.
 *
 * Flow (MUI X v8, views=['year','month','day','hours','minutes']):
 *   1. Click the open button (last button in field, after optional Clear button).
 *   2. Click month/year header → enters year-picker view.
 *   3. Click target year → MUI switches to month-picker view (because 'month' is in views).
 *   4. Click target month → MUI switches to day-calendar view.
 *   5. Click target day.
 *   6. Switch to keyboard (digital) time input via "edit time" button.
 *   7. Fill hours and minutes via text inputs.
 *   8. Click AM or PM.
 *   9. Click OK.
 *
 * Why no prev/next month navigation:
 *   Clicking a year in year-picker view causes MUI to show the month-picker
 *   (not the day calendar). Prev/Next month arrows are only visible in day-calendar
 *   view, so they cannot be used to navigate from year-picker view.
 *   Instead, clicking year → month → day reaches any date in 3 steps.
 *
 * Selectors target MUI X v8 with enableAccessibleFieldDOMStructure=false.
 */
Cypress.Commands.add('fillDateTime', (label: string, dateString: string) => {
  const parts = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!parts) throw new Error(`fillDateTime: Expected "MM/DD/YYYY HH:MM AM/PM", got "${dateString}"`);
  const [, month, day, year, hour, minute, ampm] = parts;

  const targetYear = parseInt(year);
  const targetMonth = parseInt(month); // 1-12
  const targetDay = parseInt(day);
  const targetMonthName = PICKER_MONTH_NAMES[targetMonth - 1];

  // 1. Open the picker
  cy.contains('label', label).parent().find('button').last().click();
  cy.get('.MuiPickerPopper-root').should('be.visible');

  // 2. Click the month/year header → year-picker view
  cy.get('.MuiPickersCalendarHeader-label').click();

  // 3. Select the target year → month-picker view
  cy.get('.MuiYearCalendar-root button').contains(String(targetYear)).scrollIntoView().click();

  // 4. Select the target month → day-calendar view
  //    Month buttons use aria-label = full month name (e.g. "January")
  cy.get(`.MuiMonthCalendar-root [aria-label="${targetMonthName}"]`).click();

  // 5. Click the target day — aria-label format: "January 15, 2025"
  cy.get(`.MuiPickersDay-root`).contains(String(targetDay)).click();

  // 6. Switch to keyboard (digital) time input
  //cy.get('.MuiPickersPopper-root').find('button[aria-label="edit time"]').click();

  // 7. Fill hours and minutes
  cy.get('.MuiPickerPopper-root').find('ul[aria-label="Select hours"]').children().contains(hour).scrollIntoView().click();
  cy.get('.MuiPickerPopper-root').find('ul[aria-label="Select minutes"]').children().contains(minute).scrollIntoView().click();

  // 8. Click AM or PM
  cy.get('.MuiPickerPopper-root').find('ul[aria-label="Select meridiem"]').children().contains(ampm).click();

  // 9. Confirm
  cy.get('.MuiPickerPopper-root').contains('button', 'OK').click();
});

/**
 * Clear MUI DateTimePicker by clicking its clear button.
 * Requires DateTimeWrapper to have clearable={true} on the field slot.
 */
Cypress.Commands.add('clearDateTime', (label: string) => {
  cy.contains('label', label).parent().find('button[aria-label="Clear value"]').click();
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