/**
 * Cypress helpers for interacting with MUI DataGrid components
 */

/**
 * Scope a query to a specific embedded child DataGrid by its <h2> title
 * (cmd_632). A parent form can render more than one embedded DataGrid at
 * once (multiple datagrid children, e.g. parent1_child1s + parent1_child2s)
 * — every such grid renders its <h2>{title}</h2> heading via the shared
 * `showTitle`/`title` props (FieldsDataGrid.tsx / OrderedFieldsDataGrid.tsx),
 * so the heading text is the one identifier already guaranteed unique per
 * grid on the page (it's also what `cy.clickButton('Add ' + title)` already
 * relies on). Without scoping, selectors like `.MuiDataGrid-virtualScroller`
 * or `div[role="row"][data-rowindex="0"]` match every grid on the page at
 * once, and Cypress's single-element commands (`.scrollTo()`, `.click()`)
 * throw ("can only scroll 1 element, you tried to scroll N elements") the
 * moment a second datagrid child is present. `childTitle` is optional and
 * omitted entirely keeps the old unscoped (whole-document) behavior, which
 * is still correct for the common single-grid case (e.g. the top-level list
 * page) and for any pre-cmd_632 callers.
 */
function scopedGet(selector: string, childTitle?: string) {
  return childTitle
    ? cy.contains('h2', childTitle).parent().find(selector)
    : cy.get(selector);
}

/**
 * Get a DataGrid row by index
 * @param rowIndex - 0-based row index
 * @param childTitle - Optional: scope to the embedded child DataGrid whose
 *   <h2> heading matches this title (see scopedGet doc above).
 */
export function getDataGridRow(rowIndex: number, childTitle?: string) {
  return scopedGet(`div[role="row"][data-rowindex="${rowIndex}"]`, childTitle);
}

/**
 * Get a cell in a DataGrid row
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 * @param childTitle - Optional: scope to a specific embedded child DataGrid (see getDataGridRow).
 */
export function getDataGridCell(rowIndex: number, field: string, childTitle?: string) {
  return getDataGridRow(rowIndex, childTitle).find(`div[data-field="${field}"]`);
}

/**
 * Edit a text cell in DataGrid
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 * @param value - Value to type
 * @param submit - Whether to press Enter after typing (default: false)
 * @param childTitle - Optional: scope to a specific embedded child DataGrid (see getDataGridRow).
 */
export function editDataGridCell(
  rowIndex: number,
  field: string,
  value: string | number,
  submit: boolean = false,
  childTitle?: string
) {
  getDataGridCell(rowIndex, field, childTitle).scrollIntoView();
  getDataGridCell(rowIndex, field, childTitle).dblclick();
  getDataGridCell(rowIndex, field, childTitle).find('input').should('be.visible').type('{selectall}' + String(value));
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
 * @param childTitle - Optional: scope to a specific embedded child DataGrid (see getDataGridRow).
 */
export function toggleDataGridCheckbox(
  rowIndex: number,
  field: string,
  checked: boolean = true,
  childTitle?: string
) {
  getDataGridCell(rowIndex, field, childTitle).scrollIntoView();
  getDataGridCell(rowIndex, field, childTitle).dblclick();
  const checkbox = getDataGridCell(rowIndex, field, childTitle).find('input[type="checkbox"]');
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
 * @param childTitle - Optional: scope to a specific embedded child DataGrid (see getDataGridRow).
 */
export function fillDataGridRow(
  rowIndex: number,
  data: Record<string, string | number | boolean>,
  submitLast: boolean = true,
  childTitle?: string
) {
  const fields = Object.keys(data);

  fields.forEach((field, index) => {
    const value = data[field];
    const isLast = index === fields.length - 1;

    if (typeof value === 'boolean') {
      toggleDataGridCheckbox(rowIndex, field, value, childTitle);
      if (isLast && submitLast) {
        cy.get('p').first().click(); // Click outside to commit the edit, as some cells may have async validation that prevents Enter key from working.
        // getDataGridCell(rowIndex, field).find('input').type('{enter}');
      }
    } else {
      editDataGridCell(rowIndex, field, value, isLast && submitLast, childTitle);
    }
  });
}

/**
 * Select a value from a MUI DataGrid singleSelect cell (FK EntityAutocompleteCellEditor
 * or nativeEnum GridEditSingleSelectCell).
 * Double-clicks the cell to open the Select dropdown, then clicks the matching option.
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 * @param label - Display label of the option to select (and to click in the listbox)
 * @param value - The underlying stored value the cell's input holds after selection.
 *   Defaults to `label`, which matches the FK EntityAutocompleteCellEditor (label ==
 *   stored value there). nativeEnum columns store the raw enum member (e.g. 'pie')
 *   while displaying a translated label (e.g. 'Pie'), so callers for those columns
 *   must pass the raw value explicitly.
 * @param childTitle - Optional: scope to a specific embedded child DataGrid (see getDataGridRow).
 */
export function selectDataGridSingleSelect(rowIndex: number, field: string, label: string, value: string = label, childTitle?: string) {
  const matchLabel = label.trim().replace(/\s+/g, ' ');
  getDataGridCell(rowIndex, field, childTitle).dblclick();
  getDataGridCell(rowIndex, field, childTitle).click();
  cy.get('[role="option"]').contains(matchLabel).click();
  // The grid runs in `editMode="row"`, so the cell stays in edit mode after the
  // option click and the chosen value lives on the input's `value` (not in cell
  // textContent). Asserting on the input value also acts as the "wait for the
  // edit buffer to be written" gate before fillDataGridRow proceeds.
  getDataGridCell(rowIndex, field, childTitle).find('input').should('have.value', value);
  cy.press(Cypress.Keyboard.Keys.TAB);
  scopedGet('.MuiDataGrid-virtualScroller', childTitle).scrollTo('left', { ensureScrollable: false });
  scopedGet(`div[role="row"][aria-rowindex="1"]`, childTitle).find(`input[type="checkbox"]`).click();
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
 * Get the total number of rows from MUI DataGrid's aria-rowcount attribute.
 * Unlike getDataGridRowCount, this is not affected by virtual-scroll windowing:
 * MUI DataGrid sets aria-rowcount = 1 (header) + total_data_rows on the grid element.
 */
export function getDataGridTotalRowCount() {
  return cy.get('div[role="grid"]')
    .invoke('attr', 'aria-rowcount')
    .then(val => parseInt(val ?? '1', 10) - 1);
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
