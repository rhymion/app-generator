import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import DateTimeWrapper from './DateTimeWrapper';

// Mock MUI X pickers — testing wrapper logic, not picker internals
vi.mock('@mui/x-date-pickers/LocalizationProvider', () => ({
  LocalizationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@mui/x-date-pickers/AdapterDayjs', () => ({
  AdapterDayjs: class {},
}));
vi.mock('@mui/x-date-pickers/DateTimePicker', () => ({
  DateTimePicker: ({ label, readOnly, views }: { label: string; readOnly?: boolean; views?: string[] }) => (
    <div
      data-testid="date-time-picker"
      data-readonly={readOnly ? 'true' : 'false'}
      data-views={views?.join(',')}
    >
      {label}
    </div>
  ),
}));
vi.mock('@mui/x-date-pickers/TimePicker', () => ({
  TimePicker: ({ label, readOnly }: { label: string; readOnly?: boolean }) => (
    <div
      data-testid="time-picker"
      data-readonly={readOnly ? 'true' : 'false'}
    >
      {label}
    </div>
  ),
}));

describe('DateTimeWrapper', () => {
  describe('Picker selection', () => {
    it('renders DateTimePicker when show_date=true (default)', () => {
      render(<DateTimeWrapper label="Event Time" date_time={null} />);
      expect(screen.getByTestId('date-time-picker')).toBeInTheDocument();
      expect(screen.queryByTestId('time-picker')).not.toBeInTheDocument();
    });

    it('renders TimePicker when show_date=false and show_time=true', () => {
      render(<DateTimeWrapper label="Start Time" date_time={null} show_date={false} show_time={true} />);
      expect(screen.getByTestId('time-picker')).toBeInTheDocument();
      expect(screen.queryByTestId('date-time-picker')).not.toBeInTheDocument();
    });

    it('renders no picker when show_date=false and show_time=false', () => {
      render(<DateTimeWrapper label="Hidden" date_time={null} show_date={false} show_time={false} />);
      expect(screen.queryByTestId('date-time-picker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('time-picker')).not.toBeInTheDocument();
    });

    it('renders DateTimePicker (not TimePicker) when show_date=true and show_time=false', () => {
      render(<DateTimeWrapper label="Date Only" date_time={null} show_date={true} show_time={false} />);
      expect(screen.getByTestId('date-time-picker')).toBeInTheDocument();
      expect(screen.queryByTestId('time-picker')).not.toBeInTheDocument();
    });
  });

  describe('Label', () => {
    it('passes label to DateTimePicker', () => {
      render(<DateTimeWrapper label="Scheduled At" date_time={null} />);
      expect(screen.getByText('Scheduled At')).toBeInTheDocument();
    });

    it('passes label to TimePicker', () => {
      render(<DateTimeWrapper label="Meeting Time" date_time={null} show_date={false} show_time={true} />);
      expect(screen.getByText('Meeting Time')).toBeInTheDocument();
    });
  });

  describe('Date value', () => {
    it('renders with a null date without error', () => {
      render(<DateTimeWrapper label="When" date_time={null} />);
      expect(screen.getByTestId('date-time-picker')).toBeInTheDocument();
    });

    it('renders with a Date value without error', () => {
      render(<DateTimeWrapper label="When" date_time={new Date('2024-06-15T09:30:00Z')} />);
      expect(screen.getByTestId('date-time-picker')).toBeInTheDocument();
    });
  });

  describe('readOnly prop', () => {
    it('passes readOnly=true to DateTimePicker', () => {
      render(<DateTimeWrapper label="Timestamp" date_time={null} readOnly={true} />);
      expect(screen.getByTestId('date-time-picker')).toHaveAttribute('data-readonly', 'true');
    });

    it('does not set readOnly on DateTimePicker by default', () => {
      render(<DateTimeWrapper label="Timestamp" date_time={null} />);
      expect(screen.getByTestId('date-time-picker')).toHaveAttribute('data-readonly', 'false');
    });

    it('passes readOnly=true to TimePicker', () => {
      render(<DateTimeWrapper label="Time" date_time={null} show_date={false} show_time={true} readOnly={true} />);
      expect(screen.getByTestId('time-picker')).toHaveAttribute('data-readonly', 'true');
    });
  });

  describe('Views configuration', () => {
    it('includes time views when show_time=true', () => {
      render(<DateTimeWrapper label="Full" date_time={null} show_date={true} show_time={true} />);
      const picker = screen.getByTestId('date-time-picker');
      expect(picker.getAttribute('data-views')).toContain('hours');
      expect(picker.getAttribute('data-views')).toContain('minutes');
    });

    it('excludes time views when show_time=false', () => {
      render(<DateTimeWrapper label="Date only" date_time={null} show_date={true} show_time={false} />);
      const picker = screen.getByTestId('date-time-picker');
      expect(picker.getAttribute('data-views')).not.toContain('hours');
      expect(picker.getAttribute('data-views')).not.toContain('minutes');
    });
  });
});
