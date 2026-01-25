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
  const input = getDataGridCell(rowIndex, field).find('input');
  input.clear().type(String(value));
  if (submit) {
    input.type('{enter}');
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
 * Fill multiple cells in a DataGrid row
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
        getDataGridCell(rowIndex, field).find('input').type('{enter}');
      }
    } else {
      editDataGridCell(rowIndex, field, value, isLast && submitLast);
    }
  });
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
  cy.contains('No rows').should('be.visible');
}

/**
 * Get the number of rows in DataGrid
 */
export function getDataGridRowCount() {
  return cy.get('div[role="row"][data-rowindex]').its('length');
}
