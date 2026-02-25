import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export class TickTestUtils {
  static async tickRows(rows: number[]) {
    const headerCheckbox = await screen.getAllByRole('checkbox')[0];
    if (headerCheckbox.getAttribute('aria-label') === 'Select all rows') {
      await userEvent.click(headerCheckbox); // select all
    }
    await userEvent.click(headerCheckbox); // Clear all selections
    for (const rowIndex of rows) {
      const checkboxes = await screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[rowIndex]);
    }
  }
}