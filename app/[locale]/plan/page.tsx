import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getPlanPagedData, fetchPlanPage } from '@/lib/plan/getters';
import { removePlan } from '@/lib/plan/actions';
import { DEFAULT_PAGE_SIZE, type PageOpts } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function PlanListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <PlanListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PlanListContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const sp = await searchParams;
  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const rawPageSize = Array.isArray(sp.pageSize) ? sp.pageSize[0] : sp.pageSize;
  const pageNum = Number(rawPage ?? 0);
  const pageSizeNum = Number(rawPageSize ?? DEFAULT_PAGE_SIZE);

  const [t, tf, tierLabelsT] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
    getTranslations('Fields'),
  ]);
  const tierLabels: Record<number, string> = {
    0: tierLabelsT('tier_free'),
    1: tierLabelsT('tier_premium'),
    2: tierLabelsT('tier_vip'),
  };
  const { planPage, userPermissions } = await getPlanPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  const formattedPlans = planPage.rows.map(item => ({
    ...item,
    tier: tierLabels[item.tier as number] ?? '',
  }));

  // Wrap the raw fetcher so client refetches (next page / sort / filter) return
  // rows in the same formatted shape as the initial render.
  async function fetchFormattedPlanPage(opts: PageOpts) {
    'use server';
    const raw = await fetchPlanPage(opts);
    const tierLabelsT = await getTranslations('Fields');
    const tierLabels: Record<number, string> = {
      0: tierLabelsT('tier_free'),
      1: tierLabelsT('tier_premium'),
      2: tierLabelsT('tier_vip'),
    };
    return {
      ...raw,
      rows: raw.rows.map(item => ({
        ...item,
    tier: tierLabels[item.tier as number] ?? '',
      })),
    };
  }
  return (
    <>
      <AppListToolbar
        title={t('plan')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('plan')}
        initialRows={formattedPlans}
        initialRowCount={ planPage.total }
        initialPage={ planPage.page }
        initialPageSize={ planPage.pageSize }
        fetchPage={ fetchFormattedPlanPage }
        permissions={userPermissions}
        basePath="/plan"
        removeAction={removePlan}
        displayFields={[
          { field: 'tier', headerName: tf('tier'), width: 150 },
          { field: 'sub_account_limit', headerName: tf('subAccountLimit'), width: 150 },
          { field: 'can_view_paid_posts', headerName: tf('canViewPaidPosts'), width: 150 }
        ]}
        primaryField="tier"
      />
    </>
  );
}
