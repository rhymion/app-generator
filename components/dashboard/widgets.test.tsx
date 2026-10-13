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
});
