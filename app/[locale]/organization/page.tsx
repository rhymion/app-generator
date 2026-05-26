import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getOrganizationPagedData, fetchOrganizationPage } from '@/lib/organization/getters';
import { removeOrganization } from '@/lib/organization/actions';
import { DEFAULT_PAGE_SIZE } from '@/lib/_pagination';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export default function OrganizationListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <OrganizationListContent searchParams={searchParams} />
    </Suspense>
  );
}

async function OrganizationListContent({
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
  const { organizationPage, userPermissions } = await getOrganizationPagedData({
    page: Number.isFinite(pageNum) ? pageNum : 0,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : DEFAULT_PAGE_SIZE,
  });
  return (
    <>
      <h1>{t('organization')}</h1>
      <ResponsiveListClient
        entityLabel={t('organization')}
        initialRows={organizationPage.rows}
        initialRowCount={ organizationPage.total }
        initialPage={ organizationPage.page }
        initialPageSize={ organizationPage.pageSize }
        fetchPage={ fetchOrganizationPage }
        permissions={userPermissions}
        basePath="/organization"
        removeAction={removeOrganization}
      />
    </>
  );
}
