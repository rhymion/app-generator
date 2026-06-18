import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getCharacterPagedData, fetchCharacterPage } from '@/lib/character/getters';
import { removeCharacter } from '@/lib/character/actions';
import { DEFAULT_PAGE_SIZE } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function CharacterListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <CharacterListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CharacterListContent({
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
  const { characterPage, userPermissions } = await getCharacterPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  return (
    <>
      <AppListToolbar
        title={t('character')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('character')}
        initialRows={characterPage.rows}
        initialRowCount={ characterPage.total }
        initialPage={ characterPage.page }
        initialPageSize={ characterPage.pageSize }
        fetchPage={ fetchCharacterPage }
        permissions={userPermissions}
        basePath="/character"
        removeAction={removeCharacter}
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 200 },
          { field: 'official_image', headerName: tf('officialImage'), width: 120 }
        ]}
        primaryField="name"
      />
    </>
  );
}
