import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getApprovalFlowPagedData, fetchApprovalFlowPage } from '@/lib/approval_flow/getters';
import { removeApprovalFlow } from '@/lib/approval_flow/actions';
import { DEFAULT_PAGE_SIZE, type PageOpts } from '@/lib/_pagination';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function ApprovalFlowListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <ApprovalFlowListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ApprovalFlowListContent({
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
  const { approvalFlowPage, userPermissions } = await getApprovalFlowPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  const formattedApprovalFlows = approvalFlowPage.rows.map(item => ({
    ...item,
    requestor_role: (item.requestor_role?.name ?? ''),
    approver_role: (item.approver_role?.name ?? ''),
  }));

  // Wrap the raw fetcher so client refetches (next page / sort / filter) return
  // rows in the same formatted shape as the initial render.
  async function fetchFormattedApprovalFlowPage(opts: PageOpts) {
    'use server';
    const raw = await fetchApprovalFlowPage(opts);
    return {
      ...raw,
      rows: raw.rows.map(item => ({
        ...item,
    requestor_role: (item.requestor_role?.name ?? ''),
    approver_role: (item.approver_role?.name ?? ''),
      })),
    };
  }
  return (
    <>
      <h1>{t('approvalFlow')}</h1>
      <ResponsiveListClient
        entityLabel={t('approvalFlow')}
        initialRows={formattedApprovalFlows}
        initialRowCount={ approvalFlowPage.total }
        initialPage={ approvalFlowPage.page }
        initialPageSize={ approvalFlowPage.pageSize }
        fetchPage={ fetchFormattedApprovalFlowPage }
        permissions={userPermissions}
        basePath="/approval_flow"
        removeAction={removeApprovalFlow}
        displayFields={[
          { field: 'entity_name', headerName: tf('entityName'), width: 200 },
          { field: 'requestor_role', headerName: tf('requestorRole'), width: 150 },
          { field: 'approver_role', headerName: tf('approverRole'), width: 150 }
        ]}
        primaryField="entity_name"
      />
    </>
  );
}
