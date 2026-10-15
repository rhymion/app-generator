import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { GridFilterInputValueProps } from '@mui/x-data-grid';

let mockLocale = 'en';
vi.mock('next-intl', () => ({ useLocale: () => mockLocale }));
vi.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/_standard/SidebarContext', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Providers from '@/app/[locale]/providers';
import { DataGridDateFilterInput, dateColumnProps } from './DataGridDatePickers';

function renderFilter(locale: string, kind: 'date' | 'dateTime', applyValue = vi.fn()) {
  mockLocale = locale;
  const props = {
    item: { id: 1, field: 'when', operator: 'is', value: new Date('2026-10-15') },
    applyValue,
    kind,
  } as unknown as GridFilterInputValueProps & { kind: 'date' | 'dateTime' };
  render(
    <Providers>
      <DataGridDateFilterInput {...props} />
    </Providers>,
  );
  return applyValue;
}

describe('DataGridDateFilterInput calendar language', () => {
  it('shows English month names in the calendar when the app locale is en', () => {
    renderFilter('en', 'date');
    fireEvent.click(screen.getByRole('button', { name: /choose date/i }));
    expect(within(screen.getByRole('dialog')).getByText('October 2026')).toBeTruthy();
  });

  it('shows Japanese calendar text when the app locale is ja', () => {
    renderFilter('ja', 'date');
    fireEvent.click(screen.getByRole('button', { name: /日付を選択/ }));
    expect(within(screen.getByRole('dialog')).getByText(/10月/)).toBeTruthy();
  });

  it('follows the locale for dateTime columns too', () => {
    renderFilter('ja', 'dateTime');
    fireEvent.click(screen.getByRole('button', { name: /日付を選択/ }));
    expect(within(screen.getByRole('dialog')).getByText(/10月/)).toBeTruthy();
  });
});

describe('dateColumnProps', () => {
  it('replaces the input of every value-taking operator and keeps isEmpty / isNotEmpty', () => {
    const ops = dateColumnProps('date').filterOperators!;
    const byName = Object.fromEntries(ops.map((o) => [o.value, o]));
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(['is', 'not', 'after', 'onOrAfter', 'before', 'onOrBefore', 'isEmpty', 'isNotEmpty']));
    expect(byName.is.InputComponent).toBeDefined();
    expect(byName.isEmpty.InputComponent).toBeUndefined();
  });

  it('returns the same operator objects on every call (no remount per render)', () => {
    expect(dateColumnProps('dateTime').filterOperators).toBe(dateColumnProps('dateTime').filterOperators);
    expect(dateColumnProps('dateTime').renderEditCell).toBe(dateColumnProps('dateTime').renderEditCell);
  });

});
