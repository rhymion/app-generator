import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import VersionHistoryPanel from './VersionHistoryPanel';

vi.mock('next-intl', () => ({
  useTranslations: (_ns: string) => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const rows = [
  { id: 'd', version_no: null, created_at: '2026-01-03', body: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty thirty-one', lines: [{ note: 'a' }] },
  { id: 'v2', version_no: 2, created_at: '2026-01-02', body: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty', lines: [{ note: 'a' }, { note: 'b' }] },
  { id: 'v1', version_no: 1, created_at: '2026-01-01', body: 'x', lines: [] },
];

function setup(opts: { canCreateVersion?: boolean; currentVersionId?: string | null; rows?: typeof rows } = {}) {
  const { canCreateVersion = true, currentVersionId = 'v2', rows: data = rows } = opts;
  const getHistory = vi.fn().mockResolvedValue({ rows: data, currentVersionId, canCreateVersion });
  const getDiff = vi.fn(async (_i: string, l: string, r: string) => ({
    left: rows.find((x) => x.id === l)!, right: rows.find((x) => x.id === r)!,
  }));
  render(
    <VersionHistoryPanel
      identityId="i1" newVersionHref="/doc_version/new?new_version_of=i1" numberField="version_no" fields={['body']}
      childSpecs={[{ property_name: 'lines', title_key: 'lines', fields: ['note'], match: 'none', key_fields: [] }]}
      getHistory={getHistory} getDiff={getDiff}
      renderField={(row, f) => <span>{String(row[f])}</span>}
    />,
  );
  return { getDiff };
}

describe('VersionHistoryPanel', () => {
  it('lists every version including the draft and marks the current one', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('version-row-d')).toBeTruthy());
    expect(screen.getByTestId('version-row-d').textContent).toContain('draft');
    expect(screen.getByTestId('version-row-v2').textContent).toContain('current');
    expect(screen.getByTestId('version-row-v1').textContent).toContain('superseded');
  });

  it('compares the open draft against the current version by default, with a word diff of long text', async () => {
    const { getDiff } = setup();
    await waitFor(() => expect(getDiff).toHaveBeenCalledWith('i1', 'v2', 'd'));
    await waitFor(() => expect(screen.getByTestId('diff-words-body')).toBeTruthy());
    expect(screen.getByTestId('diff-field-body').getAttribute('data-changed')).toBe('true');
    expect(screen.getByTestId('diff-words-body').querySelector('[data-kind="added"]')?.textContent).toContain('thirty-one');
  });

  it('reports additions and removals only for child rows that cannot be matched', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('diff-rows-unmatched')).toBeTruthy());
    const statuses = Array.from(screen.getByTestId('diff-children-lines').querySelectorAll('[data-status]')).map((e) => e.getAttribute('data-status'));
    expect(statuses).toEqual(['removed', 'removed', 'added']);
  });

  it('links to the new version screen when the caller may create a version and a current version exists', async () => {
    setup();
    const link = await screen.findByTestId('new-version-link');
    expect(link.getAttribute('href')).toBe('/doc_version/new?new_version_of=i1');
  });

  it('hides the new version link without create permission', async () => {
    setup({ canCreateVersion: false });
    await waitFor(() => expect(screen.getByTestId('version-history')).toBeTruthy());
    expect(screen.queryByTestId('new-version-link')).toBeNull();
  });

  it('hides the new version link while no version is current', async () => {
    setup({ currentVersionId: null, rows: [rows[0]] });
    await waitFor(() => expect(screen.getByTestId('version-history')).toBeTruthy());
    expect(screen.queryByTestId('new-version-link')).toBeNull();
  });
});
