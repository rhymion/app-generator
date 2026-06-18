import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getChannelPagedData, fetchChannelPage } from '@/lib/channel/getters';
import { removeChannel } from '@/lib/channel/actions';
import { DEFAULT_PAGE_SIZE, type PageOpts } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function ChannelListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <ChannelListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ChannelListContent({
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
    0: kindLabelsT('kind_general'),
    1: kindLabelsT('kind_consider'),
  };
  const { channelPage, userPermissions } = await getChannelPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  const formattedChannels = channelPage.rows.map(item => ({
    ...item,
    kind: kindLabels[item.kind as number] ?? '',
    organization: (item.organization?.name ?? ''),
  }));

  // Wrap the raw fetcher so client refetches (next page / sort / filter) return
  // rows in the same formatted shape as the initial render.
  async function fetchFormattedChannelPage(opts: PageOpts) {
    'use server';
    const raw = await fetchChannelPage(opts);
    const kindLabelsT = await getTranslations('Fields');
    const kindLabels: Record<number, string> = {
      0: kindLabelsT('kind_general'),
      1: kindLabelsT('kind_consider'),
    };
    return {
      ...raw,
      rows: raw.rows.map(item => ({
        ...item,
    kind: kindLabels[item.kind as number] ?? '',
    organization: (item.organization?.name ?? ''),
      })),
    };
  }
  return (
    <>
      <AppListToolbar
        title={t('channel')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('channel')}
        initialRows={formattedChannels}
        initialRowCount={ channelPage.total }
        initialPage={ channelPage.page }
        initialPageSize={ channelPage.pageSize }
        fetchPage={ fetchFormattedChannelPage }
        permissions={userPermissions}
        basePath="/channel"
        allowCreate={false}
        removeAction={removeChannel}
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 200 },
          { field: 'kind', headerName: tf('kind'), width: 120 },
          { field: 'organization', headerName: tf('organization'), width: 150 },
          { field: 'parent_type', headerName: tf('parentType'), width: 120 },
          { field: 'parent_label', headerName: tf('parentLabel'), width: 200 }
        ]}
        primaryField="name"
      />
    </>
  );
}
