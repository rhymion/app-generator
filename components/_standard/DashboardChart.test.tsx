import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import DashboardChart from './DashboardChart';
import type { ChartDatum } from './DashboardChart';

vi.mock('@mui/x-charts/PieChart', () => ({
  PieChart: ({ series, height }: { series: unknown[]; height: number }) => (
    <div data-testid="pie-chart" data-series-count={series.length} data-height={height} />
  ),
}));

vi.mock('@mui/x-charts/BarChart', () => ({
  BarChart: ({ series, height }: { series: unknown[]; height: number }) => (
    <div data-testid="bar-chart" data-series-count={series.length} data-height={height} />
  ),
}));

const sampleData: ChartDatum[] = [
  { label: 'Alpha', count: 10 },
  { label: 'Beta', count: 20 },
];

describe('DashboardChart', () => {
  describe('empty state', () => {
    it('renders "No data" message when data array is empty (pie)', () => {
      render(<DashboardChart type="pie" data={[]} />);
      expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('renders "No data" message when data array is empty (bar)', () => {
      render(<DashboardChart type="bar" data={[]} />);
      expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('does not render any chart when data is empty', () => {
      render(<DashboardChart type="pie" data={[]} />);
      expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    });
  });

  describe('type="pie"', () => {
    it('renders PieChart with data', () => {
      render(<DashboardChart type="pie" data={sampleData} />);
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('does not render BarChart', () => {
      render(<DashboardChart type="pie" data={sampleData} />);
      expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    });
  });

  describe('type="bar"', () => {
    it('renders BarChart with data', () => {
      render(<DashboardChart type="bar" data={sampleData} />);
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('does not render PieChart', () => {
      render(<DashboardChart type="bar" data={sampleData} />);
      expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
    });
  });

  describe('height prop', () => {
    it('passes default height 240 to chart', () => {
      render(<DashboardChart type="bar" data={sampleData} />);
      expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-height', '240');
    });

    it('passes custom height to chart', () => {
      render(<DashboardChart type="pie" data={sampleData} height={300} />);
      expect(screen.getByTestId('pie-chart')).toHaveAttribute('data-height', '300');
    });
  });
});
