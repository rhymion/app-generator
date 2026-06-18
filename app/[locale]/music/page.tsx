import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getMusicPagedData, fetchMusicPage } from '@/lib/music/getters';
import { removeMusic } from '@/lib/music/actions';
import { DEFAULT_PAGE_SIZE, type PageOpts } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function MusicListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <MusicListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function MusicListContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const sp = await searchParams;
  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const rawPageSize = Array.isArray(sp.pageSize) ? sp.pageSize[0] : sp.pageSize;
  const pageNum = Number(rawPage ?? 0);
  const pageSizeNum = Number(rawPageSize ?? DEFAULT_PAGE_SIZE);

  const [t, tf, kindLabelsT] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
    getTranslations('Fields'),
  ]);
  const kindLabels: Record<number, string> = {
    0: kindLabelsT('kind_op'),
    1: kindLabelsT('kind_cd'),
    2: kindLabelsT('kind_bgm'),
    3: kindLabelsT('kind_insert'),
  };
  const { musicPage, userPermissions } = await getMusicPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  const formattedMusics = musicPage.rows.map(item => ({
    ...item,
    kind: kindLabels[item.kind as number] ?? '',
  }));

  // Wrap the raw fetcher so client refetches (next page / sort / filter) return
  // rows in the same formatted shape as the initial render.
  async function fetchFormattedMusicPage(opts: PageOpts) {
    'use server';
    const raw = await fetchMusicPage(opts);
    const kindLabelsT = await getTranslations('Fields');
    const kindLabels: Record<number, string> = {
      0: kindLabelsT('kind_op'),
      1: kindLabelsT('kind_cd'),
      2: kindLabelsT('kind_bgm'),
      3: kindLabelsT('kind_insert'),
    };
    return {
      ...raw,
      rows: raw.rows.map(item => ({
        ...item,
    kind: kindLabels[item.kind as number] ?? '',
      })),
    };
  }
  return (
    <>
      <AppListToolbar
        title={t('music')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('music')}
        initialRows={formattedMusics}
        initialRowCount={ musicPage.total }
        initialPage={ musicPage.page }
        initialPageSize={ musicPage.pageSize }
        fetchPage={ fetchFormattedMusicPage }
        permissions={userPermissions}
        basePath="/music"
        removeAction={removeMusic}
        displayFields={[
          { field: 'title', headerName: tf('title'), width: 200 },
          { field: 'kind', headerName: tf('kind'), width: 120 }
        ]}
        primaryField="title"
      />
    </>
  );
}
