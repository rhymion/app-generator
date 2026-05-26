import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getSettingPagedData, fetchSettingPage } from '@/lib/setting/getters';
import { DEFAULT_PAGE_SIZE } from '@/lib/_pagination';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function SettingListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <SettingListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SettingListContent({
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
  const { settingPage, userPermissions } = await getSettingPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  return (
    <>
      <h1>{t('setting')}</h1>
      <ResponsiveListClient
        entityLabel={t('setting')}
        initialRows={settingPage.rows}
        initialRowCount={ settingPage.total }
        initialPage={ settingPage.page }
        initialPageSize={ settingPage.pageSize }
        fetchPage={ fetchSettingPage }
        permissions={userPermissions}
        basePath="/setting"
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 150 }
        ]}
        primaryField="name"
      />
    </>
  );
}
