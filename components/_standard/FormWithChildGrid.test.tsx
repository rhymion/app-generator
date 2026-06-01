import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import FormWithChildGrid from './FormWithChildGrid';

vi.mock('next-intl', () => ({
  useTranslations: (_ns: string) => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const defaultProps = {
  title: 'Edit Item',
  isEdit: true,
  formFields: <input data-testid="form-field" />,
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onBack: vi.fn(),
};

describe('FormWithChildGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders title', () => {
      render(<FormWithChildGrid {...defaultProps} />);
      expect(screen.getByText('Edit Item')).toBeInTheDocument();
    });

    it('renders form fields', () => {
      render(<FormWithChildGrid {...defaultProps} />);
      expect(screen.getByTestId('form-field')).toBeInTheDocument();
    });

    it('shows error message when error prop provided', () => {
      render(<FormWithChildGrid {...defaultProps} error="Something went wrong" />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('does not show error area when error is null', () => {
      render(<FormWithChildGrid {...defaultProps} error={null} />);
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('shows delete button when isEdit=true and onDelete provided', () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(<FormWithChildGrid {...defaultProps} onDelete={onDelete} deleteEntityLabel="Widget" />);
      expect(screen.getByLabelText('Delete Widget')).toBeInTheDocument();
    });

    it('does not show delete button when onDelete is absent', () => {
      render(<FormWithChildGrid {...defaultProps} />);
      expect(screen.queryByLabelText(/^Delete /)).not.toBeInTheDocument();
    });

    it('does not show delete button when isEdit=false even with onDelete', () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(<FormWithChildGrid {...defaultProps} isEdit={false} onDelete={onDelete} deleteEntityLabel="Widget" />);
      expect(screen.queryByLabelText('Delete Widget')).not.toBeInTheDocument();
    });

    it('renders submit button with custom label', () => {
      render(<FormWithChildGrid {...defaultProps} submitButtonLabel="Update" />);
      expect(screen.getByLabelText('Update')).toBeInTheDocument();
    });
  });

  describe('back dialog', () => {
    it('opens back dialog when back button clicked', async () => {
      render(<FormWithChildGrid {...defaultProps} />);
      fireEvent.click(screen.getByLabelText('Back to List'));
      await waitFor(() => {
        expect(screen.getByText('backDialogTitle')).toBeInTheDocument();
      });
    });

    it('calls onBack after confirming back dialog', async () => {
      render(<FormWithChildGrid {...defaultProps} />);
      fireEvent.click(screen.getByLabelText('Back to List'));
      await waitFor(() => screen.getByText('goBack'));
      fireEvent.click(screen.getByText('goBack'));
      expect(defaultProps.onBack).toHaveBeenCalledOnce();
    });

    it('does not call onBack when back dialog is cancelled', async () => {
      render(<FormWithChildGrid {...defaultProps} />);
      fireEvent.click(screen.getByLabelText('Back to List'));
      await waitFor(() => screen.getByText('cancel'));
      fireEvent.click(screen.getAllByText('cancel')[0]);
      expect(defaultProps.onBack).not.toHaveBeenCalled();
    });
  });

  describe('delete dialog', () => {
    it('opens delete dialog when delete button clicked', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(<FormWithChildGrid {...defaultProps} onDelete={onDelete} deleteEntityLabel="Item" />);
      fireEvent.click(screen.getByLabelText('Delete Item'));
      await waitFor(() => {
        expect(screen.getByText(/deleteDialogTitle/)).toBeInTheDocument();
      });
    });

    it('calls onDelete after confirming delete dialog', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(<FormWithChildGrid {...defaultProps} onDelete={onDelete} />);
      fireEvent.click(screen.getByLabelText('Delete Item'));
      await waitFor(() => screen.getByLabelText('Delete'));
      fireEvent.click(screen.getByLabelText('Delete'));
      await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    });
  });
});
