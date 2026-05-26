import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getPermissionPagedData, fetchPermissionPage } from '@/lib/permission/getters';
import { removePermission } from '@/lib/permission/actions';
import { DEFAULT_PAGE_SIZE, type PageOpts } from '@/lib/_pagination';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function PermissionListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <PermissionListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PermissionListContent({
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
  const { permissionPage, userPermissions } = await getPermissionPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  const formattedPermissions = permissionPage.rows.map(item => ({
    ...item,
    role: (item.role?.name ?? ''),
  }));

  // Wrap the raw fetcher so client refetches (next page / sort / filter) return
  // rows in the same formatted shape as the initial render.
  async function fetchFormattedPermissionPage(opts: PageOpts) {
    'use server';
    const raw = await fetchPermissionPage(opts);
    return {
      ...raw,
      rows: raw.rows.map(item => ({
        ...item,
    role: (item.role?.name ?? ''),
      })),
    };
  }
  return (
    <>
      <h1>{t('permission')}</h1>
      <ResponsiveListClient
        entityLabel={t('permission')}
        initialRows={formattedPermissions}
        initialRowCount={ permissionPage.total }
        initialPage={ permissionPage.page }
        initialPageSize={ permissionPage.pageSize }
        fetchPage={ fetchFormattedPermissionPage }
        permissions={userPermissions}
        basePath="/permission"
        removeAction={removePermission}
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 200 },
          { field: 'role', headerName: tf('role'), width: 200 }
        ]}
      />
    </>
  );
}
