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

  describe('save and continue editing', () => {
    it('renders exactly one submit button when continueButtonLabel is absent', () => {
      const { container } = render(<FormWithChildGrid {...defaultProps} />);
      expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
      expect(screen.queryByLabelText('Save and continue editing')).not.toBeInTheDocument();
    });

    it('renders a second submit button with value "continue" when continueButtonLabel is given', () => {
      const { container } = render(
        <FormWithChildGrid {...defaultProps} continueButtonLabel="Save and continue editing" />,
      );
      expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(2);
      const continueButton = screen.getByLabelText('Save and continue editing');
      expect(continueButton).toHaveAttribute('type', 'submit');
      expect(continueButton).toHaveAttribute('value', 'continue');
    });

    it('keeps the plain Save button without a "continue" value', () => {
      render(<FormWithChildGrid {...defaultProps} continueButtonLabel="Save and continue editing" />);
      expect(screen.getByLabelText('Save').getAttribute('value')).not.toBe('continue');
    });

    it('submits the form through the continue button', async () => {
      render(<FormWithChildGrid {...defaultProps} continueButtonLabel="Save and continue editing" />);
      fireEvent.click(screen.getByLabelText('Save and continue editing'));
      await waitFor(() => expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1));
    });
  });

  describe('shown in the create-in-place dialog (x-create-inline)', () => {
    it('shows the usual back control with its confirmation on its own page', () => {
      render(<FormWithChildGrid {...defaultProps} />);
      fireEvent.click(screen.getByLabelText('Back to List'));
      expect(defaultProps.onBack).not.toHaveBeenCalled();
      expect(screen.getByText('backDialogTitle')).toBeInTheDocument();
    });

    it('cancels at once, with no return-to-list confirmation, when inDialog', () => {
      render(<FormWithChildGrid {...defaultProps} inDialog />);
      expect(screen.queryByLabelText('Back to List')).not.toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('cancel'));
      expect(defaultProps.onBack).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('backDialogTitle')).not.toBeInTheDocument();
    });
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
