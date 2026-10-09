import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResponsiveListClient from './ResponsiveListClient';
import type { ListQuerySpec } from '@/lib/_list_query';
import type { PageOpts, PageResult } from '@/lib/_pagination';
import { renderWithIntl } from '../../vitest/i18n';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

interface Row {
  id: string;
  name: string;
  qty: number;
  [key: string]: unknown;
}

const spec: ListQuerySpec = {
  fields: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'qty', label: 'Quantity', kind: 'number' },
    { key: 'status', label: 'Status', kind: 'enum', options: ['open', 'closed'] },
  ],
  sortKeys: ['name', 'qty', 'status'],
  filterKeys: ['name', 'qty', 'status'],
  searchKey: 'name',
};

const rows: Row[] = [
  { id: '1', name: 'Bolt', qty: 5 },
  { id: '2', name: 'Nut', qty: 7 },
];

const displayFields = [
  { field: 'name', headerName: 'Name' },
  { field: 'qty', headerName: 'Quantity' },
] as const;

/** Makes `(max-width: ...)` match, as it does on a phone-sized viewport, or not. */
function setViewport(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderList(fetchPage: (opts: PageOpts) => Promise<PageResult<Row>>) {
  return renderWithIntl(
    <ResponsiveListClient<Row>
      initialRows={rows}
      initialRowCount={2}
      initialPage={0}
      initialPageSize={50}
      fetchPage={fetchPage}
      basePath="/items"
      displayFields={displayFields as never}
      listQuery={spec}
    />,
  );
}

type FetchMock = Mock<(opts: PageOpts) => Promise<PageResult<Row>>>;
const lastOpts = (fetchPage: FetchMock): PageOpts => fetchPage.mock.calls.at(-1)![0];

describe.each([
  { viewport: 'desktop', mobile: false, grid: 'grid' },
  { viewport: 'mobile web', mobile: true, grid: 'cards' },
])('list search panel on a $viewport viewport', ({ mobile, grid }) => {
  let fetchPage: FetchMock;

  beforeEach(() => {
    setViewport(mobile);
    fetchPage = vi.fn(async (opts: PageOpts) => ({ rows, total: 2, page: opts.page ?? 0, pageSize: opts.pageSize ?? 50 }));
  });

  afterEach(() => {
    // @ts-expect-error -- restore jsdom's default of no matchMedia
    delete window.matchMedia;
  });

  it('shows the list in the layout of the viewport, with the panel above it', async () => {
    renderList(fetchPage);
    expect(screen.getByTestId('list-query-panel')).toBeInTheDocument();
    if (grid === 'cards') expect(screen.getByTestId('mobile-card-list')).toBeInTheDocument();
    else expect(screen.queryByTestId('mobile-card-list')).toBeNull();
    expect(screen.getByTestId('list-search')).toBeInTheDocument();
  });

  it('queries by several sort columns at once', async () => {
    renderList(fetchPage);
    await userEvent.click(screen.getByTestId('list-sort-toggle'));
    await userEvent.click(screen.getByTestId('list-sort-status'));
    await userEvent.click(screen.getByTestId('list-sort-qty'));
    await userEvent.click(screen.getByTestId('list-sort-qty'));
    await waitFor(() =>
      expect(lastOpts(fetchPage)).toMatchObject({
        page: 0,
        sort: [
          { field: 'status', dir: 'asc' },
          { field: 'qty', dir: 'desc' },
        ],
      }),
    );
  });

  it('queries by several filtered fields at once', async () => {
    renderList(fetchPage);
    await userEvent.click(screen.getByTestId('list-filter-toggle'));
    await userEvent.type(screen.getByTestId('list-filter-name'), 'bo');
    await userEvent.type(screen.getByTestId('list-filter-qty'), '5');
    await userEvent.click(screen.getByTestId('list-filter-status-open'));
    await waitFor(() => expect(lastOpts(fetchPage).filter).toEqual({ name: 'bo', qty: '5', status: 'open' }));
  });

  it('searches the title column and keeps the sort and the other filters', async () => {
    renderList(fetchPage);
    await userEvent.click(screen.getByTestId('list-sort-toggle'));
    await userEvent.click(screen.getByTestId('list-sort-name'));
    await userEvent.click(screen.getByTestId('list-filter-toggle'));
    await userEvent.click(screen.getByTestId('list-filter-status-closed'));
    await userEvent.type(screen.getByTestId('list-search'), 'nu');
    await waitFor(() =>
      expect(lastOpts(fetchPage)).toMatchObject({
        sort: [{ field: 'name', dir: 'asc' }],
        filter: { status: 'closed', name: 'nu' },
      }),
    );
  });

  it('goes back to an unfiltered, unsorted list when everything is cleared', async () => {
    renderList(fetchPage);
    await userEvent.click(screen.getByTestId('list-sort-toggle'));
    await userEvent.click(screen.getByTestId('list-sort-qty'));
    await userEvent.click(screen.getByTestId('list-sort-clear'));
    await waitFor(() => expect(lastOpts(fetchPage)).toMatchObject({ sort: [], filter: {} }));
  });
});

describe('list header sort with the panel on a desktop viewport', () => {
  it('sorts by the clicked column alone, replacing the panel sort', async () => {
    setViewport(false);
    const fetchPage = vi.fn(async (opts: PageOpts) => ({ rows, total: 2, page: opts.page ?? 0, pageSize: opts.pageSize ?? 50 }));
    renderList(fetchPage);
    await userEvent.click(screen.getByTestId('list-sort-toggle'));
    await userEvent.click(screen.getByTestId('list-sort-status'));
    await userEvent.click(screen.getByTestId('list-sort-qty'));
    await waitFor(() => expect(lastOpts(fetchPage).sort).toHaveLength(2));
    await userEvent.click(screen.getByRole('columnheader', { name: /^Name/ }));
    await waitFor(() => expect(lastOpts(fetchPage).sort).toEqual([{ field: 'name', dir: 'asc' }]));
    expect(screen.getByTestId('list-sort-toggle')).toHaveTextContent('Sort: Name ↑');
    // @ts-expect-error -- restore jsdom's default of no matchMedia
    delete window.matchMedia;
  });
});

describe('list without a search panel spec', () => {
  it('shows no panel and keeps the single-column grid', () => {
    setViewport(false);
    renderWithIntl(
      <ResponsiveListClient<Row>
        initialRows={rows}
        initialRowCount={2}
        fetchPage={async () => ({ rows, total: 2, page: 0, pageSize: 50 })}
        basePath="/items"
        displayFields={displayFields as never}
      />,
    );
    expect(screen.queryByTestId('list-query-panel')).toBeNull();
    // @ts-expect-error -- restore jsdom's default of no matchMedia
    delete window.matchMedia;
  });
});
