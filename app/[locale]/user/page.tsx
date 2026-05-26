import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getUserPagedData, fetchUserPage } from '@/lib/user/getters';
import { removeUser } from '@/lib/user/actions';
import { DEFAULT_PAGE_SIZE } from '@/lib/_pagination';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function UserListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <UserListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function UserListContent({
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
  const { userPage, userPermissions } = await getUserPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  return (
    <>
      <h1>{t('user')}</h1>
      <ResponsiveListClient
        entityLabel={t('user')}
        initialRows={userPage.rows}
        initialRowCount={ userPage.total }
        initialPage={ userPage.page }
        initialPageSize={ userPage.pageSize }
        fetchPage={ fetchUserPage }
        permissions={userPermissions}
        basePath="/user"
        removeAction={removeUser}
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 150 }
        ]}
        primaryField="name"
      />
    </>
  );
}
