import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getTipTxPagedData, fetchTipTxPage } from '@/lib/tip_tx/getters';
import { removeTipTx } from '@/lib/tip_tx/actions';
import { DEFAULT_PAGE_SIZE, type PageOpts } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function TipTxListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <TipTxListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function TipTxListContent({
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
    1: statusLabelsT('status_held'),
    2: statusLabelsT('status_paid'),
  };
  const { tipTxPage, userPermissions } = await getTipTxPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  const formattedTipTxs = tipTxPage.rows.map(item => ({
    ...item,
    status: statusLabels[item.status as number] ?? '',
  }));

  // Wrap the raw fetcher so client refetches (next page / sort / filter) return
  // rows in the same formatted shape as the initial render.
  async function fetchFormattedTipTxPage(opts: PageOpts) {
    'use server';
    const raw = await fetchTipTxPage(opts);
    const statusLabelsT = await getTranslations('Fields');
    const statusLabels: Record<number, string> = {
      0: statusLabelsT('status_pending'),
      1: statusLabelsT('status_held'),
      2: statusLabelsT('status_paid'),
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
        title={t('tipTx')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('tipTx')}
        initialRows={formattedTipTxs}
        initialRowCount={ tipTxPage.total }
        initialPage={ tipTxPage.page }
        initialPageSize={ tipTxPage.pageSize }
        fetchPage={ fetchFormattedTipTxPage }
        permissions={userPermissions}
        basePath="/tip_tx"
        removeAction={removeTipTx}
        displayFields={[
          { field: 'status', headerName: tf('status'), width: 120 },
          { field: 'gross_amount', headerName: tf('grossAmount'), width: 150 },
          { field: 'updated_at', headerName: tf('updatedAt'), width: 180, format: 'date-time' }
        ]}
        primaryField="status"
      />
    </>
  );
}
