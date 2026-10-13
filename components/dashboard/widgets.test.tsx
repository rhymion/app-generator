import React, { createRef } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Widgets, { type WidgetsHandle } from './widgets';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) =>
    Object.assign((key: string) => `${ns}:${key}`, { has: (key: string) => key === 'task' }),
}));

const catalog = vi.hoisted(() => ({
  entities: [
    { name: 'task', label: 'Task', groupable_fields: [] },
    { name: 'secret_note', label: 'Secret Note', groupable_fields: [] },
  ] as Array<{ name: string; label: string; groupable_fields: unknown[] }>,
}));

vi.mock('./catalog-source', () => ({
  get DASHBOARDABLE_ENTITIES() { return catalog.entities; },
  findDashboardEntity: (name: string) => catalog.entities.find((e) => e.name === name),
}));

vi.mock('@/lib/dashboard/readable-entities', () => ({
  getReadableDashboardEntityNames: vi.fn(),
}));

import { getReadableDashboardEntityNames } from '@/lib/dashboard/readable-entities';
const mockReadable = vi.mocked(getReadableDashboardEntityNames);

const baseRow = {
  id: 'w1',
  name: 'Tasks by status',
  entity_name: 'task',
  group_by_field: 'status',
  chart_type: 'column',
  stack_mode: null,
  group_by_bucket: null,
  timezone: 'utc',
  series_field: null,
  filter_field: null,
  filter_value: null,
  order: 0,
};

const createNewRow = () => ({ ...baseRow, id: 'temp-new', name: '', entity_name: '', group_by_field: '' });

describe('dashboard widget editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalog.entities = [
      { name: 'task', label: 'Task', groupable_fields: [] },
      { name: 'secret_note', label: 'Secret Note', groupable_fields: [] },
    ];
    mockReadable.mockResolvedValue(['task']);
  });

  it('offers only the catalog entities the user can read, with translated labels', async () => {
    render(<Widgets initialFields={[{ ...baseRow, entity_name: '' }]} createNewRow={createNewRow} />);
    await waitFor(() => expect(mockReadable).toHaveBeenCalled());
    const input = screen.getByLabelText(/Fields:entityName/);
    fireEvent.mouseDown(input);
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('EntityLabel:task')).toBeInTheDocument();
    expect(within(listbox).queryByText(/secret/i)).not.toBeInTheDocument();
  });

  it('stores the entity key of the chosen data source', async () => {
    const ref = createRef<WidgetsHandle>();
    render(<Widgets ref={ref} initialFields={[{ ...baseRow, entity_name: '' }]} createNewRow={createNewRow} />);
    await waitFor(() => expect(mockReadable).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/Fields:entityName/)).toBeEnabled());
    fireEvent.mouseDown(screen.getByLabelText(/Fields:entityName/));
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByText('EntityLabel:task'));
    expect(ref.current?.getFields()[0]).toMatchObject({ entity_name: 'task' });
  });

  it('keeps a valid stored entity_name unchanged', async () => {
    const ref = createRef<WidgetsHandle>();
    render(<Widgets ref={ref} initialFields={[baseRow]} createNewRow={createNewRow} />);
    await waitFor(() => expect(mockReadable).toHaveBeenCalled());
    expect(ref.current?.getFields()[0]).toMatchObject({ id: 'w1', entity_name: 'task', order: 0 });
  });

  it('flags a stored entity_name that is not a dashboard data source', async () => {
    render(<Widgets initialFields={[{ ...baseRow, entity_name: 'gone' }]} createNewRow={createNewRow} />);
    expect(await screen.findByText('DashboardWidgetEditor:unknownDataSource')).toBeInTheDocument();
  });

  it('warns when the stored data source exists but the user cannot read it', async () => {
    render(<Widgets initialFields={[{ ...baseRow, entity_name: 'secret_note' }]} createNewRow={createNewRow} />);
    expect(await screen.findByText('DashboardWidgetEditor:unreadableDataSource')).toBeInTheDocument();
  });

  it('says so when no entity opts into the dashboard', async () => {
    catalog.entities = [];
    mockReadable.mockResolvedValue([]);
    render(<Widgets initialFields={[]} createNewRow={createNewRow} />);
    expect(await screen.findByText(/DashboardWidgetEditor:noDashboardEntities/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'DashboardWidgetEditor:docsLinkLabel' })).toHaveAttribute('href', 'DashboardWidgetEditor:docsUrl');
  });

  it('adds, reorders and removes widgets and reports the order through getFields', async () => {
    const ref = createRef<WidgetsHandle>();
    render(<Widgets ref={ref} initialFields={[baseRow]} createNewRow={createNewRow} />);
    await waitFor(() => expect(mockReadable).toHaveBeenCalled());
    fireEvent.click(screen.getByText('DashboardWidgetEditor:addWidget'));
    expect(ref.current?.getFields().map((r) => r.id)).toEqual(['w1', 'temp-new']);
    fireEvent.click(screen.getAllByText('DashboardWidgetEditor:moveUp')[1]);
    expect(ref.current?.getFields().map((r) => [r.id, r.order])).toEqual([['temp-new', 0], ['w1', 1]]);
    fireEvent.click(screen.getAllByText('DashboardWidgetEditor:removeWidget')[0]);
    expect(ref.current?.getFields().map((r) => r.id)).toEqual(['w1']);
  });

  describe('field dropdowns', () => {
    const fields = [
      { name: 'status', label: 'Status', kind: 'enum', enum_values: ['open'] },
      { name: 'created_at', label: 'Created At', kind: 'datetime', datetime_format: 'date-time' },
      { name: 'owner_id', label: 'Owner', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
    ];
    beforeEach(() => {
      catalog.entities = [{ name: 'task', label: 'Task', groupable_fields: fields }];
    });
    const columns = [
      { field: 'chart_type', valueOptions: [{ value: 'column', label: 'Column' }, { value: 'line', label: 'Line' }, { value: 'pie', label: 'Pie' }] },
      { field: 'group_by_bucket', valueOptions: [{ value: '', label: '' }, { value: 'day', label: 'Day' }] },
      { field: 'stack_mode', valueOptions: [{ value: 'grouped', label: 'Grouped' }] },
    ];
    const open = async (initial: Record<string, unknown>) => {
      const ref = createRef<WidgetsHandle>();
      render(<Widgets ref={ref} initialFields={[{ ...baseRow, ...initial }]} createNewRow={createNewRow} columns={columns} />);
      await waitFor(() => expect(mockReadable).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByLabelText(/Fields:groupByField/)).toBeEnabled());
      return ref;
    };

    it('lists the fields of the selected data source with their kind', async () => {
      await open({});
      fireEvent.mouseDown(screen.getByLabelText(/Fields:groupByField/));
      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getByText('Created At (DashboardWidgetEditor.fieldKind:datetime)')).toBeInTheDocument();
      expect(within(listbox).getByText('Owner (DashboardWidgetEditor.fieldKind:fk)')).toBeInTheDocument();
    });

    it('hides the bucket for a non-datetime group-by and the series for a pie', async () => {
      await open({ chart_type: 'pie' });
      expect(screen.queryByLabelText(/Fields:groupByBucket/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Fields:seriesField/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Fields:stackMode/)).not.toBeInTheDocument();
    });

    it('shows the bucket for a datetime group-by', async () => {
      await open({ group_by_field: 'created_at' });
      expect(screen.getByLabelText(/Fields:groupByBucket/)).toBeInTheDocument();
    });

    it('clears the fields when the data source changes', async () => {
      catalog.entities = [...catalog.entities, { name: 'bug', label: 'Bug', groupable_fields: [] }];
      mockReadable.mockResolvedValue(['task', 'bug']);
      const ref = await open({ series_field: 'owner_id' });
      fireEvent.mouseDown(screen.getByLabelText(/Fields:entityName/));
      const listbox = await screen.findByRole('listbox');
      fireEvent.click(within(listbox).getByText('Bug'));
      expect(ref.current?.getFields()[0]).toMatchObject({ entity_name: 'bug', group_by_field: '', series_field: null });
    });

    it('keeps the stored values of an unchanged widget', async () => {
      const ref = await open({ series_field: 'owner_id', stack_mode: 'grouped' });
      expect(ref.current?.getFields()[0]).toMatchObject({ group_by_field: 'status', series_field: 'owner_id', stack_mode: 'grouped' });
    });

    it('flags a stored group-by field the data source does not offer', async () => {
      await open({ group_by_field: 'gone' });
      expect(screen.getByText('DashboardWidgetEditor:unknownField')).toBeInTheDocument();
    });

    it('explains a filter on a field the data source does not offer', async () => {
      await open({ filter_field: 'gone', filter_value: 'x' });
      expect(screen.getByText('DashboardWidgetProblem:unknownField')).toBeInTheDocument();
    });

    it('explains a filter value that does not fit the filtered field', async () => {
      await open({ filter_field: 'status', filter_value: 'archived' });
      expect(screen.getByText('DashboardWidgetProblem:invalidFilterValue')).toBeInTheDocument();
    });

    it('shows no problem for a consistent widget', async () => {
      await open({ filter_field: 'status', filter_value: 'open' });
      expect(screen.queryByText(/^DashboardWidgetProblem:/)).not.toBeInTheDocument();
    });
  });
});
