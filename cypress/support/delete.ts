import { expect } from 'vitest';
// Brings the jest-dom matchers (e.g. toBeInTheDocument) and their type
// augmentation onto vitest's `expect`. vitest.setup.ts loads this for the
// vitest run, but this helper is also compiled under cypress/tsconfig.json
// (types: ["cypress"]), which otherwise wouldn't see the matcher types.
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export class DeleteTestUtils {
  static async deleteSelectedRows(deleteSelectedButton: HTMLElement) {
    await userEvent.click(deleteSelectedButton);
    await waitFor(() => expect(screen.getByRole('dialog', { hidden: false })).toBeInTheDocument());
    const confirmDeleteButton = screen.getAllByRole('button', { name: /delete/i }).find(btn => btn.closest('[role="dialog"]'));
    await userEvent.click(confirmDeleteButton!);
  }
}