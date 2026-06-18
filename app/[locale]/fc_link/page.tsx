import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getFcLinkPagedData, fetchFcLinkPage } from '@/lib/fc_link/getters';
import { removeFcLink } from '@/lib/fc_link/actions';
import { DEFAULT_PAGE_SIZE } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function FcLinkListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <FcLinkListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function FcLinkListContent({
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
  const { fcLinkPage, userPermissions } = await getFcLinkPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  return (
    <>
      <AppListToolbar
        title={t('fcLink')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('fcLink')}
        initialRows={fcLinkPage.rows}
        initialRowCount={ fcLinkPage.total }
        initialPage={ fcLinkPage.page }
        initialPageSize={ fcLinkPage.pageSize }
        fetchPage={ fetchFcLinkPage }
        permissions={userPermissions}
        basePath="/fc_link"
        allowCreate={false}
        removeAction={removeFcLink}
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 200 },
          { field: 'url', headerName: tf('url'), width: 280, uriKind: 'link' },
          { field: 'parent_type', headerName: tf('parentType'), width: 120 },
          { field: 'parent_label', headerName: tf('parentLabel'), width: 200 }
        ]}
        primaryField="name"
      />
    </>
  );
}
