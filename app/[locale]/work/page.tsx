import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getWorkPagedData, fetchWorkPage } from '@/lib/work/getters';
import { removeWork } from '@/lib/work/actions';
import { DEFAULT_PAGE_SIZE, type PageOpts } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function WorkListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <WorkListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function WorkListContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const sp = await searchParams;
  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const rawPageSize = Array.isArray(sp.pageSize) ? sp.pageSize[0] : sp.pageSize;
  const pageNum = Number(rawPage ?? 0);
  const pageSizeNum = Number(rawPageSize ?? DEFAULT_PAGE_SIZE);

  const [t, tf, statusLabelsT] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
    getTranslations('Fields'),
  ]);
  const statusLabels: Record<number, string> = {
    0: statusLabelsT('status_pending'),
    1: statusLabelsT('status_approved'),
  };
  const { workPage, userPermissions } = await getWorkPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  const formattedWorks = workPage.rows.map(item => ({
    ...item,
    status: statusLabels[item.status as number] ?? '',
  }));

  // Wrap the raw fetcher so client refetches (next page / sort / filter) return
  // rows in the same formatted shape as the initial render.
  async function fetchFormattedWorkPage(opts: PageOpts) {
    'use server';
    const raw = await fetchWorkPage(opts);
    const statusLabelsT = await getTranslations('Fields');
    const statusLabels: Record<number, string> = {
      0: statusLabelsT('status_pending'),
      1: statusLabelsT('status_approved'),
    };
    return {
      ...raw,
      rows: raw.rows.map(item => ({
        ...item,
    status: statusLabels[item.status as number] ?? '',
      })),
    };
  }
  return (
    <>
      <AppListToolbar
        title={t('work')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('work')}
        initialRows={formattedWorks}
        initialRowCount={ workPage.total }
        initialPage={ workPage.page }
        initialPageSize={ workPage.pageSize }
        fetchPage={ fetchFormattedWorkPage }
        permissions={userPermissions}
        basePath="/work"
        removeAction={removeWork}
        displayFields={[
          { field: 'title', headerName: tf('title'), width: 200 },
          { field: 'status', headerName: tf('status'), width: 120 }
        ]}
        primaryField="title"
      />
    </>
  );
}
