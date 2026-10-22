import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import TimeZoneSelect from './TimeZoneSelect';
import { TIMEZONE_VALUES } from '@/lib/_timezone';

// Dictionary labels are looked up by enum member, so the test labels are derived from the member:
// the options must come from the enum and the labels from the dictionary, not from Intl.
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
}));

describe('TimeZoneSelect', () => {
  it('lists every enum member with its dictionary label and nothing else', async () => {
    const user = userEvent.setup();
    render(<TimeZoneSelect label="Time zone" value="utc" onChange={vi.fn()} />);
    await user.click(screen.getByLabelText('Time zone'));
    const listbox = await screen.findByRole('listbox');
    const labels = within(listbox).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(TIMEZONE_VALUES.map((tz) => `Timezone:${tz}`));
    expect(labels).toHaveLength(54);
  });

  it('never shows an IANA spelling', async () => {
    const user = userEvent.setup();
    render(<TimeZoneSelect label="Time zone" value="asia_tokyo" onChange={vi.fn()} />);
    await user.click(screen.getByLabelText('Time zone'));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByText(/Asia\/Tokyo/)).toBeNull();
  });

  it('shows the label of the current member', () => {
    render(<TimeZoneSelect label="Time zone" value="asia_tokyo" onChange={vi.fn()} />);
    expect((screen.getByLabelText('Time zone') as HTMLInputElement).value).toBe('Timezone:asia_tokyo');
  });

  it('reports the chosen member, not its label', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TimeZoneSelect label="Time zone" value="utc" onChange={onChange} />);
    await user.click(screen.getByLabelText('Time zone'));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByText('Timezone:europe_paris'));
    expect(onChange).toHaveBeenCalledWith('europe_paris');
  });
});
