import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getDashboardPagedData, fetchDashboardPage } from '@/lib/dashboard/getters';
import { removeDashboard } from '@/lib/dashboard/actions';
import { DEFAULT_PAGE_SIZE } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function DashboardListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <DashboardListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardListContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const sp = await searchParams;
  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const rawPageSize = Array.isArray(sp.pageSize) ? sp.pageSize[0] : sp.pageSize;
  const pageNum = Number(rawPage ?? 0);
  const pageSizeNum = Number(rawPageSize ?? DEFAULT_PAGE_SIZE);

  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  const { dashboardPage, userPermissions } = await getDashboardPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  return (
    <>
      <AppListToolbar
        title={t('dashboard')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('dashboard')}
        initialRows={dashboardPage.rows}
        initialRowCount={ dashboardPage.total }
        initialPage={ dashboardPage.page }
        initialPageSize={ dashboardPage.pageSize }
        fetchPage={ fetchDashboardPage }
        permissions={userPermissions}
        basePath="/dashboard"
        removeAction={removeDashboard}
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 200 }
        ]}
        primaryField="name"
      />
    </>
  );
}
