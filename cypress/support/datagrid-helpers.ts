/**
 * Cypress helpers for interacting with MUI DataGrid components
 */

/**
 * Get a DataGrid row by index
 * @param rowIndex - 0-based row index
 */
export function getDataGridRow(rowIndex: number) {
  return cy.get(`div[role="row"][data-rowindex="${rowIndex}"]`);
}

/**
 * Get a cell in a DataGrid row
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 */
export function getDataGridCell(rowIndex: number, field: string) {
  return getDataGridRow(rowIndex).find(`div[data-field="${field}"]`);
}

/**
 * Edit a text cell in DataGrid
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 * @param value - Value to type
 * @param submit - Whether to press Enter after typing (default: false)
 */
export function editDataGridCell(
  rowIndex: number,
  field: string,
  value: string | number,
  submit: boolean = false
) {
  getDataGridCell(rowIndex, field).dblclick();
  getDataGridCell(rowIndex, field).find('input').should('be.visible').type('{selectall}' + String(value));
  if (submit) {
    cy.get('p').first().click(); // Click outside to commit the edit, as some cells may have async validation that prevents Enter key from working.
    // input.type('{enter}');
  }
}

/**
 * Toggle a boolean cell in DataGrid
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 * @param checked - Whether to check or uncheck
 */
export function toggleDataGridCheckbox(
  rowIndex: number,
  field: string,
  checked: boolean = true
) {
  getDataGridCell(rowIndex, field).dblclick();
  const checkbox = getDataGridCell(rowIndex, field).find('input[type="checkbox"]');
  if (checked) {
    checkbox.check();
  } else {
    checkbox.uncheck();
  }
}

/**
 * Fill multiple cells in a DataGrid row (text/number/boolean fields only).
 * For FK/singleSelect fields, use selectDataGridSingleSelect instead.
 * @param rowIndex - 0-based row index
 * @param data - Object with field names as keys and values to fill
 * @param submitLast - Whether to press Enter on the last field (default: true)
 */
export function fillDataGridRow(
  rowIndex: number,
  data: Record<string, string | number | boolean>,
  submitLast: boolean = true
) {
  const fields = Object.keys(data);

  fields.forEach((field, index) => {
    const value = data[field];
    const isLast = index === fields.length - 1;

    if (typeof value === 'boolean') {
      toggleDataGridCheckbox(rowIndex, field, value);
      if (isLast && submitLast) {
        cy.get('p').first().click(); // Click outside to commit the edit, as some cells may have async validation that prevents Enter key from working.
        // getDataGridCell(rowIndex, field).find('input').type('{enter}');
      }
    } else {
      editDataGridCell(rowIndex, field, value, isLast && submitLast);
    }
  });
}

/**
 * Select a value from a MUI DataGrid singleSelect (FK) cell.
 * Double-clicks the cell to open the Select dropdown, then clicks the matching option.
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 * @param label - Display label of the option to select
 */
export function selectDataGridSingleSelect(rowIndex: number, field: string, label: string) {
  getDataGridCell(rowIndex, field).dblclick();
  getDataGridCell(rowIndex, field).click();
  cy.get('[role="option"]').contains(label).click();
  // The grid runs in `editMode="row"`, so the cell stays in edit mode after the
  // option click and the chosen label lives on the input's `value` (not in cell
  // textContent). Asserting on the input value also acts as the "wait for the
  // edit buffer to be written" gate before fillDataGridRow proceeds.
  getDataGridCell(rowIndex, field).find('input').should('have.value', label);
  cy.press(Cypress.Keyboard.Keys.TAB);
  cy.get(`div[role="row"][aria-rowindex="1"]`).find(`input[type="checkbox"]`).click();
}

/**
 * Wait for DataGrid to be ready
 */
export function waitForDataGrid() {
  cy.get('div[role="grid"]').should('be.visible');
}

/**
 * Check if DataGrid has no rows
 */
export function assertDataGridEmpty() {
  cy.get('div[role="grid"]').should('be.visible');
  cy.contains('No rows').should('be.visible');
}

/**
 * Get the number of rows in DataGrid
 */
export function getDataGridRowCount() {
  return cy.get('div[role="row"][data-rowindex]').its('length');
}

/**
 * Assert the value of a specific cell in DataGrid
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 * @param expectedValue - Expected cell value
 */
export function assertDataGridCellValue(
  rowIndex: number,
  field: string,
  expectedValue: string | number | boolean
) {
  if (typeof expectedValue === 'boolean') {
    // For boolean fields, check checkbox state
    const assertion = expectedValue ? 'be.checked' : 'not.be.checked';
    getDataGridCell(rowIndex, field).find('input[type="checkbox"]').should(assertion);
  } else {
    // For text/number fields, check the text content
    getDataGridCell(rowIndex, field).should('contain.text', String(expectedValue));
  }
}

/**
 * Assert multiple cell values in a DataGrid row
 * @param rowIndex - 0-based row index
 * @param expectedData - Object with field names as keys and expected values
 */
export function assertDataGridRowData(
  rowIndex: number,
  expectedData: Record<string, string | number | boolean>
) {
  Object.entries(expectedData).forEach(([field, expectedValue]) => {
    assertDataGridCellValue(rowIndex, field, expectedValue);
  });
}

/**
 * Get text content from a DataGrid cell
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 * @returns Chainable with cell text
 */
export function getDataGridCellText(rowIndex: number, field: string) {
  return getDataGridCell(rowIndex, field).invoke('text');
}
