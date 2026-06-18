import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getScenePagedData, fetchScenePage } from '@/lib/scene/getters';
import { removeScene } from '@/lib/scene/actions';
import { DEFAULT_PAGE_SIZE } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function SceneListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <SceneListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SceneListContent({
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
  const { scenePage, userPermissions } = await getScenePagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  return (
    <>
      <AppListToolbar
        title={t('scene')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('scene')}
        initialRows={scenePage.rows}
        initialRowCount={ scenePage.total }
        initialPage={ scenePage.page }
        initialPageSize={ scenePage.pageSize }
        fetchPage={ fetchScenePage }
        permissions={userPermissions}
        basePath="/scene"
        removeAction={removeScene}
        displayFields={[
          { field: 'label', headerName: tf('label'), width: 200 },
          { field: 'episode', headerName: tf('episode'), width: 120 }
        ]}
        primaryField="label"
      />
    </>
  );
}
