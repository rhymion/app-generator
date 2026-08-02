import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DashboardWidget from './DashboardWidget';
import type { WidgetConfig } from './DashboardWidget';

vi.mock('@/lib/dashboard/aggregate', () => ({
  aggregateForWidget: vi.fn(),
}));

vi.mock('./DashboardChart', () => ({
  default: ({ type, data }: { type: string; data: unknown[] }) => (
    <div data-testid="dashboard-chart" data-type={type} data-count={data.length} />
  ),
}));

import { aggregateForWidget } from '@/lib/dashboard/aggregate';
const mockAggregate = vi.mocked(aggregateForWidget);

const widget: WidgetConfig = {
  id: 'w1',
  name: 'Status Chart',
  order: 0,
  entity_name: 'task',
  chart_type: 'pie',
  group_by_field: 'status',
};

describe('DashboardWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    mockAggregate.mockReturnValue(new Promise(() => {}));
    const { container } = render(<DashboardWidget widget={widget} />);
    expect(container.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
  });

  it('renders widget name in card header', async () => {
    mockAggregate.mockResolvedValue({ kind: 'single', data: [] });
    render(<DashboardWidget widget={widget} />);
    expect(screen.getByText('Status Chart')).toBeInTheDocument();
  });

  it('renders entity/group subheader', async () => {
    mockAggregate.mockResolvedValue({ kind: 'single', data: [] });
    render(<DashboardWidget widget={widget} />);
    expect(screen.getByText('task grouped by status')).toBeInTheDocument();
  });

  it('renders chart after data loads', async () => {
    mockAggregate.mockResolvedValue({ kind: 'single', data: [
      { label: 'Open', count: 5 },
      { label: 'Closed', count: 3 },
    ] });
    render(<DashboardWidget widget={widget} />);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-chart')).toBeInTheDocument();
    });
    expect(screen.getByTestId('dashboard-chart')).toHaveAttribute('data-count', '2');
  });

  it('renders with chart_type "pie"', async () => {
    mockAggregate.mockResolvedValue({ kind: 'single', data: [{ label: 'A', count: 1 }] });
    render(<DashboardWidget widget={{ ...widget, chart_type: 'pie' }} />);
    await waitFor(() => screen.getByTestId('dashboard-chart'));
    expect(screen.getByTestId('dashboard-chart')).toHaveAttribute('data-type', 'pie');
  });

  it('renders with chart_type "column"', async () => {
    mockAggregate.mockResolvedValue({ kind: 'single', data: [{ label: 'A', count: 1 }] });
    render(<DashboardWidget widget={{ ...widget, chart_type: 'column' }} />);
    await waitFor(() => screen.getByTestId('dashboard-chart'));
    expect(screen.getByTestId('dashboard-chart')).toHaveAttribute('data-type', 'column');
  });

  it('shows error message when aggregateForWidget rejects', async () => {
    mockAggregate.mockRejectedValue(new Error('Server error'));
    render(<DashboardWidget widget={widget} />);
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('passes filter to aggregateForWidget when filter_field and filter_value provided', async () => {
    mockAggregate.mockResolvedValue({ kind: 'single', data: [] });
    const filteredWidget = { ...widget, filter_field: 'priority', filter_value: 'high' };
    render(<DashboardWidget widget={filteredWidget} />);
    await waitFor(() => {
      expect(mockAggregate).toHaveBeenCalledWith(
        'task',
        'status',
        { field: 'priority', value: 'high' },
        undefined,
        undefined,
        undefined
      );
    });
  });

  it('passes null filter when filter_field is absent', async () => {
    mockAggregate.mockResolvedValue({ kind: 'single', data: [] });
    render(<DashboardWidget widget={widget} />);
    await waitFor(() => {
      expect(mockAggregate).toHaveBeenCalledWith('task', 'status', null, undefined, undefined, undefined);
    });
  });
});
