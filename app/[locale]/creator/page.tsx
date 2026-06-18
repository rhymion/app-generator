import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getCreatorPagedData, fetchCreatorPage } from '@/lib/creator/getters';
import { removeCreator } from '@/lib/creator/actions';
import { DEFAULT_PAGE_SIZE, type PageOpts } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function CreatorListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <CreatorListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CreatorListContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const sp = await searchParams;
  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const rawPageSize = Array.isArray(sp.pageSize) ? sp.pageSize[0] : sp.pageSize;
  const pageNum = Number(rawPage ?? 0);
  const pageSizeNum = Number(rawPageSize ?? DEFAULT_PAGE_SIZE);

  const [t, roleLabelsT, affiliationLabelsT] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
    getTranslations('Fields'),
  ]);
  const roleLabels: Record<number, string> = {
    0: roleLabelsT('role_voice'),
    1: roleLabelsT('role_anim'),
    2: roleLabelsT('role_bgm'),
    3: roleLabelsT('role_etc'),
  };
  const affiliationLabels: Record<number, string> = {
    0: affiliationLabelsT('affiliation_agency'),
    1: affiliationLabelsT('affiliation_freelance'),
    2: affiliationLabelsT('affiliation_student'),
  };
  const { creatorPage, userPermissions } = await getCreatorPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  const formattedCreators = creatorPage.rows.map(item => ({
    ...item,
    role: roleLabels[item.role as number] ?? '',
    affiliation: affiliationLabels[item.affiliation as number] ?? '',
  }));

  // Wrap the raw fetcher so client refetches (next page / sort / filter) return
  // rows in the same formatted shape as the initial render.
  async function fetchFormattedCreatorPage(opts: PageOpts) {
    'use server';
    const raw = await fetchCreatorPage(opts);
    const roleLabelsT = await getTranslations('Fields');
    const roleLabels: Record<number, string> = {
      0: roleLabelsT('role_voice'),
      1: roleLabelsT('role_anim'),
      2: roleLabelsT('role_bgm'),
      3: roleLabelsT('role_etc'),
    };
    const affiliationLabelsT = await getTranslations('Fields');
    const affiliationLabels: Record<number, string> = {
      0: affiliationLabelsT('affiliation_agency'),
      1: affiliationLabelsT('affiliation_freelance'),
      2: affiliationLabelsT('affiliation_student'),
    };
    return {
      ...raw,
      rows: raw.rows.map(item => ({
        ...item,
    role: roleLabels[item.role as number] ?? '',
    affiliation: affiliationLabels[item.affiliation as number] ?? '',
      })),
    };
  }
  return (
    <>
      <AppListToolbar
        title={t('creator')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('creator')}
        initialRows={formattedCreators}
        initialRowCount={ creatorPage.total }
        initialPage={ creatorPage.page }
        initialPageSize={ creatorPage.pageSize }
        fetchPage={ fetchFormattedCreatorPage }
        permissions={userPermissions}
        basePath="/creator"
        removeAction={removeCreator}
      />
    </>
  );
}
