import { screen, fireEvent } from '@testing-library/react';

export class TickTestUtils {
  static tickRows(rows: number[]) {
    const headerCheckbox = screen.getAllByRole('checkbox')[0];
    if (headerCheckbox.getAttribute('aria-label') === 'Select all rows') {
      fireEvent.click(headerCheckbox); // select all
    }
    fireEvent.click(headerCheckbox); // Clear all selections
    for (const rowIndex of rows) {
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[rowIndex]);
    }
  }
}