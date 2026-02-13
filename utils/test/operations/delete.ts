import { expect } from 'vitest';
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