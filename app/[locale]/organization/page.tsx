import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getOrganizationListPageData } from '@/lib/organization/getters';
import { removeOrganization } from '@/lib/organization/actions';

export default function OrganizationListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <OrganizationListContent />
    </Suspense>
  );
}

async function OrganizationListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { organizations, userPermissions } = await getOrganizationListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('organization')}
        src={organizations}
        permissions={userPermissions}
        basePath="/organization"
        removeAction={removeOrganization}
      />
    </>
  );
}
