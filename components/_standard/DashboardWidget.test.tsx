import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DashboardWidget from './DashboardWidget';
import type { WidgetConfig } from './DashboardWidget';

// DashboardView resolves against the real English messages; other namespaces echo their key.
const intl = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ja' }));
vi.mock('next-intl', async () => {
  const msgs = {
    en: (await import('@/messages/en.json')).default,
    ja: (await import('@/messages/ja.json')).default,
  } as unknown as Record<string, Record<string, Record<string, string>>>;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, string>) =>
      ns === 'DashboardView'
        ? Object.entries(params ?? {}).reduce((text, [k, v]) => text.replace(`{${k}}`, v), msgs[intl.locale].DashboardView[key])
        : `${ns}:${key}`,
    useMessages: () => ({}),
  };
});

// The generated catalog is absent on a clean checkout; the problem messages only need its labels.
vi.mock('@/components/dashboard/catalog-source', () => ({
  DASHBOARDABLE_ENTITIES: [],
  findDashboardEntity: vi.fn(() => undefined),
}));

vi.mock('@/lib/dashboard/aggregate', () => ({
  aggregateForWidget: vi.fn(),
}));

vi.mock('./DashboardChart', () => ({
  default: ({ type, data }: { type: string; data: unknown[] }) => (
    <div data-testid="dashboard-chart" data-type={type} data-count={data.length} data-labels={data.map((d) => (d as { label: string }).label).join('|')} />
  ),
}));

import { aggregateForWidget } from '@/lib/dashboard/aggregate';
import { findDashboardEntity } from '@/components/dashboard/catalog-source';
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
    intl.locale = 'en';
  });

  it('translates boolean and placeholder category labels before charting them', async () => {
    vi.mocked(findDashboardEntity).mockReturnValue({
      name: 'task', label: 'Task', groupable_fields: [{ name: 'status', label: 'Status', kind: 'boolean' }],
    });
    mockAggregate.mockResolvedValue({
      ok: true,
      output: { kind: 'single', data: [{ label: 'Yes', count: 1 }, { label: '(unspecified)', count: 2 }] },
    });
    intl.locale = 'ja';
    render(<DashboardWidget widget={widget} />);
    const chart = await screen.findByTestId('dashboard-chart');
    expect(chart.getAttribute('data-labels')).toBe('はい|（未指定）');
    vi.mocked(findDashboardEntity).mockReset();
  });

  it('shows loading skeleton initially', () => {
    mockAggregate.mockReturnValue(new Promise(() => {}));
    const { container } = render(<DashboardWidget widget={widget} />);
    expect(container.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
  });

  it('renders widget name in card header', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [] } });
    render(<DashboardWidget widget={widget} />);
    expect(screen.getByText('Status Chart')).toBeInTheDocument();
  });

  it('renders entity/group subheader', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [] } });
    render(<DashboardWidget widget={widget} />);
    expect(screen.getByText('task grouped by status')).toBeInTheDocument();
  });

  it('renders chart after data loads', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [
      { label: 'Open', count: 5 },
      { label: 'Closed', count: 3 },
    ] } });
    render(<DashboardWidget widget={widget} />);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-chart')).toBeInTheDocument();
    });
    expect(screen.getByTestId('dashboard-chart')).toHaveAttribute('data-count', '2');
  });

  it('renders with chart_type "pie"', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [{ label: 'A', count: 1 }] } });
    render(<DashboardWidget widget={{ ...widget, chart_type: 'pie' }} />);
    await waitFor(() => screen.getByTestId('dashboard-chart'));
    expect(screen.getByTestId('dashboard-chart')).toHaveAttribute('data-type', 'pie');
  });

  it('renders with chart_type "column"', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [{ label: 'A', count: 1 }] } });
    render(<DashboardWidget widget={{ ...widget, chart_type: 'column' }} />);
    await waitFor(() => screen.getByTestId('dashboard-chart'));
    expect(screen.getByTestId('dashboard-chart')).toHaveAttribute('data-type', 'column');
  });

  it('shows a generic translated message when the load fails unexpectedly', async () => {
    mockAggregate.mockRejectedValue(new Error('Server error'));
    render(<DashboardWidget widget={widget} />);
    await waitFor(() => {
      expect(screen.getByText('DashboardWidgetProblem:loadFailed')).toBeInTheDocument();
    });
    expect(screen.queryByText('Server error')).not.toBeInTheDocument();
  });

  it.each(['dataSourceUnavailable', 'noPermission', 'unknownField', 'bucketNeedsDatetime', 'invalidFilterValue'] as const)(
    'shows the translated message for the %s problem the aggregate returns',
    async (code) => {
      mockAggregate.mockResolvedValue({ ok: false, problem: { code, setting: 'group_by_field', params: { entity: 'task', field: 'status' } } });
      render(<DashboardWidget widget={widget} />);
      expect(await screen.findByText(`DashboardWidgetProblem:${code}`)).toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-chart')).not.toBeInTheDocument();
    },
  );

  it('explains a stack mode without a series field without asking the server', () => {
    render(<DashboardWidget widget={{ ...widget, chart_type: 'column', stack_mode: 'stacked' }} />);
    expect(screen.getByText('DashboardWidgetProblem:stackNeedsSeries')).toBeInTheDocument();
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it('explains a line chart without a time bucket without asking the server', () => {
    render(<DashboardWidget widget={{ ...widget, chart_type: 'line' }} />);
    expect(screen.getByText('DashboardWidgetProblem:lineNeedsBucket')).toBeInTheDocument();
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it('says that nothing matches, as a message and not as an error', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [] } });
    render(<DashboardWidget widget={widget} />);
    const message = await screen.findByText('DashboardWidgetProblem:noMatchingData');
    expect(message).not.toHaveClass('MuiTypography-colorError');
    expect(screen.queryByTestId('dashboard-chart')).not.toBeInTheDocument();
  });

  it('passes filter to aggregateForWidget when filter_field and filter_value provided', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [] } });
    const filteredWidget = { ...widget, filter_field: 'priority', filter_value: 'high' };
    render(<DashboardWidget widget={filteredWidget} />);
    await waitFor(() => {
      expect(mockAggregate).toHaveBeenCalledWith(
        'task',
        'status',
        { field: 'priority', value: 'high' },
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  it('passes null filter when filter_field is absent', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [] } });
    render(<DashboardWidget widget={widget} />);
    await waitFor(() => {
      expect(mockAggregate).toHaveBeenCalledWith('task', 'status', null, undefined, undefined, undefined, undefined);
    });
  });

  it('passes the stored time zone to the aggregation and names a non-UTC zone in the subheader', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [], timezone: 'asia_tokyo' } });
    render(
      <DashboardWidget
        widget={{ ...widget, group_by_field: 'created_at', chart_type: 'line', group_by_bucket: 'day', timezone: 'asia_tokyo' }}
      />,
    );
    await waitFor(() => expect(screen.getByText('task grouped by created_at (Timezone:asia_tokyo)')).toBeInTheDocument());
    expect(mockAggregate).toHaveBeenCalledWith('task', 'created_at', null, undefined, undefined, 'day', 'asia_tokyo');
  });

  it('shows no zone for a UTC widget', async () => {
    mockAggregate.mockResolvedValue({ ok: true, output: { kind: 'single', data: [] } });
    render(<DashboardWidget widget={{ ...widget, timezone: 'utc' }} />);
    await waitFor(() => expect(mockAggregate).toHaveBeenCalled());
    expect(screen.getByText('task grouped by status')).toBeInTheDocument();
  });
});
