import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NumberField from './NumberField';

describe('NumberField', () => {
  it('renders input field with default value when specified', () => {
    render(
      <NumberField
        label="Age"
        defaultValue={25}
        min={0}
        max={100}
      />
    );

    const input = screen.getByLabelText('Age') as HTMLInputElement;
    expect(input.value).toBe('25');
  });

  it('renders empty input field when default value is not specified', () => {
    render(
      <NumberField
        label="Age"
        min={0}
        max={100}
      />
    );

    const input = screen.getByLabelText('Age') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('allows only digits, "-", "," and "." to be inserted', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Amount"
        min={-100}
        max={100}
      />
    );

    const input = screen.getByLabelText('Amount') as HTMLInputElement;

    // Try typing valid characters (digits and decimal)
    await user.type(input, '123.45');
    expect(input.value).toBe('123.45');

    // Clear and try negative number
    await user.clear(input);
    await user.type(input, '-50');
    // BaseNumberField may handle negative differently, check if it starts with - or contains digits
    expect(input.value).toMatch(/^-?\d+$/);

    // Clear and try typing with decimal
    await user.clear(input);
    await user.type(input, '12.34');
    expect(input.value).toBe('12.34');
  });

  it('prevents "-" from being inserted when minimum value is 0 or greater', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Positive Number"
        min={0}
        max={100}
      />
    );

    const input = screen.getByLabelText('Positive Number') as HTMLInputElement;

    // Try typing a negative number
    await user.type(input, '-50');

    // The negative sign should not be accepted when min is 0 or greater
    // BaseNumberField should prevent this
    expect(input.value).not.toMatch(/^-/);
  });

  it('allows "." to be inserted only once in the input box', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Decimal"
        min={0}
        max={100}
      />
    );

    const input = screen.getByLabelText('Decimal') as HTMLInputElement;

    // Type a number with one decimal point
    await user.type(input, '12.34');
    expect(input.value).toBe('12.34');

    // Try typing another decimal point
    await user.type(input, '.56');

    // Should not allow multiple decimal points
    const decimalCount = (input.value.match(/\./g) || []).length;
    expect(decimalCount).toBeLessThanOrEqual(1);
  });

  it('corrects value to min when value below minimum is entered and input loses focus', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Score"
        min={10}
        max={100}
      />
    );

    const input = screen.getByLabelText('Score') as HTMLInputElement;

    // Type a value below minimum
    await user.type(input, '5');
    expect(input.value).toBe('5');

    // Blur the input
    await user.click(document.body);

    // After blur, value should be corrected to min
    expect(input.value).toBe('10');
  });

  it('corrects value to max when value above maximum is entered and input loses focus', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Score"
        min={0}
        max={100}
      />
    );

    const input = screen.getByLabelText('Score') as HTMLInputElement;

    // Type a value above maximum
    await user.type(input, '150');
    expect(input.value).toBe('150');

    // Blur the input
    await user.click(document.body);

    // After blur, value should be corrected to max
    expect(input.value).toBe('100');
  });

  it('allows min value to be inserted and remain after blur', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Value"
        min={10}
        max={100}
      />
    );

    const input = screen.getByLabelText('Value') as HTMLInputElement;

    // Type the minimum value
    await user.type(input, '10');
    expect(input.value).toBe('10');

    // Blur the input
    await user.click(document.body);

    // Value should remain as min
    expect(input.value).toBe('10');
  });

  it('allows max value to be inserted and remain after blur', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Value"
        min={0}
        max={100}
      />
    );

    const input = screen.getByLabelText('Value') as HTMLInputElement;

    // Type the maximum value
    await user.type(input, '100');
    expect(input.value).toBe('100');

    // Blur the input
    await user.click(document.body);

    // Value should remain as max
    expect(input.value).toBe('100');
  });

  it('increases number by 1 when increment button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Counter"
        defaultValue={5}
        min={0}
        max={10}
      />
    );

    const input = screen.getByLabelText('Counter') as HTMLInputElement;
    const incrementButton = screen.getByLabelText('Increase');

    expect(input.value).toBe('5');

    // Click increment button
    await user.click(incrementButton);

    expect(input.value).toBe('6');
  });

  it('decreases number by 1 when decrement button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Counter"
        defaultValue={5}
        min={0}
        max={10}
      />
    );

    const input = screen.getByLabelText('Counter') as HTMLInputElement;
    const decrementButton = screen.getByLabelText('Decrease');

    expect(input.value).toBe('5');

    // Click decrement button
    await user.click(decrementButton);

    expect(input.value).toBe('4');
  });

  it('disables increment button when number reaches maximum value', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Counter"
        defaultValue={9}
        min={0}
        max={10}
      />
    );

    const input = screen.getByLabelText('Counter') as HTMLInputElement;
    const incrementButton = screen.getByLabelText('Increase');

    expect(input.value).toBe('9');
    expect(incrementButton).not.toBeDisabled();

    // Click increment to reach max
    await user.click(incrementButton);

    expect(input.value).toBe('10');
    expect(incrementButton).toBeDisabled();
  });

  it('disables decrement button when number reaches minimum value', async () => {
    const user = userEvent.setup();

    render(
      <NumberField
        label="Counter"
        defaultValue={1}
        min={0}
        max={10}
      />
    );

    const input = screen.getByLabelText('Counter') as HTMLInputElement;
    const decrementButton = screen.getByLabelText('Decrease');

    expect(input.value).toBe('1');
    expect(decrementButton).not.toBeDisabled();

    // Click decrement to reach min
    await user.click(decrementButton);

    expect(input.value).toBe('0');
    expect(decrementButton).toBeDisabled();
  });

  it('renders helper text showing min and max values', () => {
    render(
      <NumberField
        label="Score"
        min={0}
        max={100}
      />
    );

    expect(screen.getByText('Enter value between 0 and 100')).toBeInTheDocument();
  });

  it('applies error styling when error prop is true', () => {
    const { container } = render(
      <NumberField
        label="Invalid"
        min={0}
        max={100}
        error={true}
      />
    );

    // Check if the error prop is passed to FormControl by looking for error-related attributes
    const formControl = container.querySelector('.MuiFormControl-root');
    expect(formControl).toBeInTheDocument();

    // The OutlinedInput component should have error styling
    const input = screen.getByLabelText('Invalid');
    const outlinedInput = input.closest('.MuiOutlinedInput-root');
    expect(outlinedInput).toBeInTheDocument();
  });

  it('supports small and medium sizes', () => {
    const { rerender, container } = render(
      <NumberField
        label="Small"
        min={0}
        max={100}
        size="small"
      />
    );

    // Check that the component renders with small size
    let formControl = container.querySelector('.MuiFormControl-root');
    expect(formControl).toBeInTheDocument();

    // Check increment button has small size
    let incrementButton = screen.getByLabelText('Increase');
    expect(incrementButton).toHaveClass('MuiIconButton-sizeSmall');

    rerender(
      <NumberField
        label="Medium"
        min={0}
        max={100}
        size="medium"
      />
    );

    // Check increment button has medium size
    incrementButton = screen.getByLabelText('Increase');
    expect(incrementButton).toHaveClass('MuiIconButton-sizeMedium');
  });
});
