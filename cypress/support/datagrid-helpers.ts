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
 * Click somewhere outside the DataGrid to blur/commit an in-progress cell
 * edit (cmd_776). Every FormUpsert page embedding a DataGrid child renders
 * exactly one `<h1>{title}</h1>` page heading via FormWithChildGrid — a
 * plain, non-interactive element that exists on every such page regardless
 * of which fields the parent form declares. This used to be `cy.get('p').
 * first().click()`, which grabbed the *first* `<p>` anywhere in the DOM in
 * document order; when a field on the same form renders via ImageUpload,
 * that component wraps its whole `TextField` (whose MUI helper text is a
 * `<p>`) in a `<label htmlFor="image-upload-button">`, so clicking that
 * helper-text `<p>` — if it happened to sort before any other `<p>` on the
 * page — delegated to the hidden file input and opened the browser's file
 * picker.
 */
function clickOutsideToCommit() {
  cy.get('h1').first().click();
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
 * Scroll a DataGrid horizontally until the cell for `field` is rendered. MUI DataGrid
 * virtualizes columns, so a cell far to the right of the visible area (a grid with many
 * columns, or a narrow viewport next to the sidebar) is absent from the DOM until the
 * grid is scrolled to it. Does nothing when the cell is already rendered.
 */
function revealDataGridCell(rowIndex: number, field: string, childTitle?: string) {
  const cellSelector = `div[role="row"][data-rowindex="${rowIndex}"] div[data-field="${field}"]`;
  const withGridRoot = (callback: ($root: JQuery<HTMLElement>) => void) =>
    childTitle ? cy.contains('h2', childTitle).parent().then(callback) : cy.get('body').then(callback);
  const scrollStep = (left: number) => {
    withGridRoot(($root) => {
      const $scroller = $root.find('.MuiDataGrid-virtualScroller').first();
      // No virtualized grid in scope, or the cell is already rendered: nothing to reveal.
      if ($scroller.length === 0 || $root.find(cellSelector).length > 0) return;
      if (left > 0 && left >= $scroller[0].scrollWidth) return;
      cy.wrap($scroller).scrollTo(left, 0, { duration: 0, ensureScrollable: false });
      // Let the grid render the columns that entered the viewport before re-checking.
      cy.wait(100);
      scrollStep(left + Math.max($scroller[0].clientWidth / 2, 100));
    });
  };
  scrollStep(0);
}

/**
 * Get a cell in a DataGrid row
 * @param rowIndex - 0-based row index
 * @param field - Field name (column)
 * @param childTitle - Optional: scope to a specific embedded child DataGrid (see getDataGridRow).
 */
export function getDataGridCell(rowIndex: number, field: string, childTitle?: string) {
  revealDataGridCell(rowIndex, field, childTitle);
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
// Since issue #764 generated date / dateTime columns carry a picker
// renderEditCell, and editDataGridCell() types the ISO value into the picker
// sections (typeIsoIntoPickerSections). The remainder of this note describes
// the native-input path, which still applies to a cell that renders a native
// input (the #583 regression fixture).
//
// MUI DataGrid's built-in `type: 'dateTime'` column (without renderEditCell
// override) edits through a native datetime-local
// input; a `type: 'date'` column (issue #540/#542, `format: date` fields)
// edits through a native date input. Cypress validates the *entire* string
// passed to .type() against a strict ISO regex for both of these native
// input types before consuming any special key sequence — for `type:
// 'date'` this regex accepts only bare `YYYY-MM-DD` and rejects anything
// else (including a locale-specific `MM/DD/YYYY`, confirmed empirically:
// Cypress's own error for a mismatched value names the required format as
// `YYYY-MM-DD`, independent of the browser's locale) — so the `{selectall}`
// prefix used below for every other field type makes even a correctly
// ISO-formatted value throw (issue #583). .clear() is the
// native-input-safe equivalent of `{selectall}` here (a no-op if the cell is
// already empty).
const ISO_DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Type an ISO date (`YYYY-MM-DD`) or datetime (`YYYY-MM-DDThh:mm`) into a MUI
 * picker inside a DataGrid cell, one section at a time (see typeDateSections
 * in commands.ts for why each section is clicked and typed individually).
 * Sections follow the English locale order the e2e suite runs in:
 * MM / DD / YYYY [/ hh / mm / AM|PM].
 */
function typeIsoIntoPickerSections(rowIndex: number, field: string, iso: string, childTitle?: string) {
  const [datePart, timePart] = iso.split('T');
  const [year, month, day] = datePart.split('-');
  const values = [month, day, year];
  if (timePart) {
    const [hour24, minute] = timePart.split(':');
    const h = Number(hour24);
    values.push(String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0'), minute, h >= 12 ? 'p' : 'a');
  }
  const sections = () =>
    getDataGridCell(rowIndex, field, childTitle).find('[role="group"] [role="spinbutton"]');
  values.forEach((v, i) => {
    sections().eq(i).click();
    sections().eq(i).type(v);
  });
}

/**
 * Clear a date / dateTime cell that is already in edit mode. A MUI picker keeps
 * its value in section spinbuttons (its `<input>` is hidden), so the sections
 * are emptied with select-all + backspace; a native input is cleared directly.
 */
export function clearDataGridDateCell(rowIndex: number, field: string, childTitle?: string) {
  getDataGridCell(rowIndex, field, childTitle).then(($cell) => {
    if ($cell.find('[role="group"] [role="spinbutton"]').length > 0) {
      getDataGridCell(rowIndex, field, childTitle).find('[role="group"] [role="spinbutton"]').first().click();
      getDataGridCell(rowIndex, field, childTitle)
        .find('[role="group"] [role="spinbutton"]').first().type('{selectall}{backspace}');
    } else {
      getDataGridCell(rowIndex, field, childTitle).find('input').clear();
    }
  });
}

export function editDataGridCell(
  rowIndex: number,
  field: string,
  value: string | number,
  submit: boolean = false,
  childTitle?: string
) {
  getDataGridCell(rowIndex, field, childTitle).scrollIntoView();
  getDataGridCell(rowIndex, field, childTitle).dblclick();
  const isoValue = String(value);
  if (ISO_DATETIME_LOCAL_RE.test(isoValue) || ISO_DATE_ONLY_RE.test(isoValue)) {
    // Date / dateTime columns edit through MUI pickers (issue #764): type the
    // ISO value into the picker's sections. A native date input (some host
    // fixtures) still takes the ISO string directly.
    getDataGridCell(rowIndex, field, childTitle).then(($cell) => {
      if ($cell.find('[role="group"] [role="spinbutton"]').length > 0) {
        typeIsoIntoPickerSections(rowIndex, field, isoValue, childTitle);
        if (submit) clickOutsideToCommit();
      } else {
        getDataGridCell(rowIndex, field, childTitle).find('input').should('be.visible').clear().type(isoValue);
        if (submit) clickOutsideToCommit();
      }
    });
    return;
  }
  const input = getDataGridCell(rowIndex, field, childTitle).find('input').should('be.visible');
  if (ISO_DATETIME_LOCAL_RE.test(String(value)) || ISO_DATE_ONLY_RE.test(String(value))) {
    input.clear().type(String(value));
  } else {
    input.type('{selectall}' + String(value));
  }
  if (submit) {
    clickOutsideToCommit();
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
        clickOutsideToCommit();
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
