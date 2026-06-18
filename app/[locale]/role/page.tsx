import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getRolePagedData, fetchRolePage } from '@/lib/role/getters';
import { removeRole } from '@/lib/role/actions';
import { DEFAULT_PAGE_SIZE } from '@/lib/_pagination';
import AppListToolbar from '@/components/ui/layout/AppListToolbar';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function RoleListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <RoleListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function RoleListContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const sp = await searchParams;
  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const rawPageSize = Array.isArray(sp.pageSize) ? sp.pageSize[0] : sp.pageSize;
  const pageNum = Number(rawPage ?? 0);
  const pageSizeNum = Number(rawPageSize ?? DEFAULT_PAGE_SIZE);

  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { rolePage, userPermissions } = await getRolePagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  return (
    <>
      <AppListToolbar
        title={t('role')}
      >
      </AppListToolbar>
      <ResponsiveListClient
        entityLabel={t('role')}
        initialRows={rolePage.rows}
        initialRowCount={ rolePage.total }
        initialPage={ rolePage.page }
        initialPageSize={ rolePage.pageSize }
        fetchPage={ fetchRolePage }
        permissions={userPermissions}
        basePath="/role"
        removeAction={removeRole}
      />
    </>
  );
}
