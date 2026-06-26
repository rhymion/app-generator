import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getAuditLogPagedData, fetchAuditLogPage } from '@/lib/audit_log/getters';
import { DEFAULT_PAGE_SIZE, type PageOpts } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function AuditLogListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <AuditLogListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AuditLogListContent({
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
  const { auditLogPage, userPermissions } = await getAuditLogPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  const formattedAuditLogs = auditLogPage.rows.map(item => ({
    ...item,
    actor_user: (item.actor_user?.name ?? ''),
  }));

  // Wrap the raw fetcher so client refetches (next page / sort / filter) return
  // rows in the same formatted shape as the initial render.
  async function fetchFormattedAuditLogPage(opts: PageOpts) {
    'use server';
    const raw = await fetchAuditLogPage(opts);
    return {
      ...raw,
      rows: raw.rows.map(item => ({
        ...item,
      actor_user: (item.actor_user?.name ?? ''),
      })),
    };
  }
  return (
    <>
      <AppListToolbar
        title={t('auditLog')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('auditLog')}
        initialRows={formattedAuditLogs}
        initialRowCount={ auditLogPage.total }
        initialPage={ auditLogPage.page }
        initialPageSize={ auditLogPage.pageSize }
        fetchPage={ fetchFormattedAuditLogPage }
        permissions={userPermissions}
        basePath="/audit_log"
        displayFields={[
          { field: 'action', headerName: tf('action'), width: 200 },
          { field: 'actor_user', headerName: tf('actorUser'), width: 150 },
          { field: 'created_at', headerName: tf('created_at'), width: 200 }
        ]}
        primaryField="action"
      />
    </>
  );
}
