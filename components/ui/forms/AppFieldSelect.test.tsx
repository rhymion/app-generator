import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import AppFieldSelect from './AppFieldSelect';
import type { AppFieldSelectOption } from './AppFieldSelect';

// Regression coverage for the approval-value-lockdown screen path: a
// disabled option (an approval/rejection-workflow-only value) must stay
// selectable-as-current but not newly selectable. This is what actually
// prevents the "open an already-approved record, its status field is
// blank, save wipes the value" failure mode -- the option array must
// never simply drop the value.
describe('AppFieldSelect', () => {
  const options: AppFieldSelectOption<string>[] = [
    { value: 'pending', label: 'pending' },
    { value: 'active', label: 'active', disabled: true },
    { value: 'released', label: 'released', disabled: true },
  ];

  it('displays a disabled option as the current value (not blank) when the field already holds it', () => {
    render(
      <AppFieldSelect
        label="Status"
        options={options}
        value={options[1]} // 'active' -- an approval-only value already on the record
        onChange={vi.fn()}
      />
    );
    const input = screen.getByLabelText('Status') as HTMLInputElement;
    expect(input.value).toBe('active');
  });

  it('renders a disabled option in the dropdown as non-selectable (aria-disabled)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AppFieldSelect
        label="Status"
        options={options}
        value={options[1]}
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText('Status');
    await user.click(input);
    const listbox = await screen.findByRole('listbox');
    const releasedOption = within(listbox).getByText('released').closest('li');
    expect(releasedOption).toHaveAttribute('aria-disabled', 'true');

    // A real pointer cannot click this option at all: MUI applies
    // `pointer-events: none` to a disabled option, and
    // @testing-library/user-event's realistic pointer simulation refuses
    // to even attempt the click (throws "Unable to perform pointer
    // interaction" rather than firing one) -- this is not a lint-only
    // convention, it's genuinely unclickable by an actual mouse.
    expect(releasedOption).toHaveStyle({ pointerEvents: 'none' });
    await expect(user.click(releasedOption as Element)).rejects.toThrow(
      /pointer-events: none/
    );
    expect(onChange).not.toHaveBeenCalled();

    // The screen-level disable is a UX affordance, not the security
    // boundary -- it stops an accidental/normal click, but a
    // programmatic DOM event (bypassing real pointer-event rules, as a
    // browser devtools console or a scripted client could) still reaches
    // the same onChange the enabled options use. That gap is exactly why
    // the actual enforcement lives server-side (service_validation.ts /
    // api_import_route.ts.jinja2's APPROVAL_LOCKED_FIELDS check) rather
    // than being trusted to the screen alone.
    fireEvent.click(releasedOption as Element);
    expect(onChange).toHaveBeenCalledWith('released');
  });

  it('an ordinary (non-locked) option remains fully selectable', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AppFieldSelect
        label="Status"
        options={options}
        value={options[1]}
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText('Status');
    await user.click(input);
    const listbox = await screen.findByRole('listbox');
    const pendingOption = within(listbox).getByText('pending');
    await user.click(pendingOption);
    expect(onChange).toHaveBeenCalledWith('pending');
  });

  it('does not remove a disabled option from the array -- current value is always resolvable', () => {
    // The exact bug this option-array-always-includes-locked-values design
    // prevents: generators.py's enum_str_props loop building the options
    // array with `{{ opts_var }}.find((o) => o.value === {{ sn }}) ?? null`
    // -- if a locked value were filtered OUT of the options array entirely
    // (instead of marked disabled), .find() would return undefined and the
    // field would render blank even though the record legitimately holds
    // that value.
    const found = options.find((o) => o.value === 'active');
    expect(found).toBeDefined();
    expect(found?.disabled).toBe(true);
  });
});
