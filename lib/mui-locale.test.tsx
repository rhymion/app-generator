import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useTheme } from '@mui/material/styles';
import { getDayjsLocale, getMuiLocaleBundles } from './mui-locale';

let mockLocale = 'en';
vi.mock('next-intl', () => ({ useLocale: () => mockLocale }));
vi.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/_standard/SidebarContext', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Providers from '@/app/[locale]/providers';

function Probe() {
  const theme = useTheme();
  const grid = (theme.components as Record<string, { defaultProps?: { localeText?: Record<string, string> } }>)
    .MuiDataGrid?.defaultProps?.localeText;
  return <div data-testid="probe">{grid?.columnMenuSortAsc ?? 'none'}</div>;
}

describe('getMuiLocaleBundles / getDayjsLocale', () => {
  it('returns Japanese bundles (core, DataGrid, pickers) for ja', () => {
    expect(getMuiLocaleBundles('ja')).toHaveLength(3);
    expect(getDayjsLocale('ja')).toBe('ja');
  });

  it('adds no bundle for the library-default English locale', () => {
    expect(getMuiLocaleBundles('en')).toEqual([]);
    expect(getDayjsLocale('en')).toBe('en');
  });

  it('falls back to English for an unknown locale', () => {
    expect(getMuiLocaleBundles('xx')).toEqual([]);
    expect(getDayjsLocale('xx')).toBe('en');
  });
});

describe('Providers theme follows the app locale', () => {
  it('wires the Japanese DataGrid localeText for ja', () => {
    mockLocale = 'ja';
    render(<Providers><Probe /></Providers>);
    expect(screen.getByTestId('probe').textContent).not.toBe('none');
    expect(screen.getByTestId('probe').textContent).toMatch(/[぀-ヿ一-鿿]/);
  });

  it('keeps the library default (no localeText override) for en', () => {
    mockLocale = 'en';
    render(<Providers><Probe /></Providers>);
    expect(screen.getByTestId('probe').textContent).toBe('none');
  });
});
