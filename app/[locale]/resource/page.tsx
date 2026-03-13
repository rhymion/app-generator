import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getResourceListPageData } from '@/lib/resource/getters';
import { removeResource } from '@/lib/resource/actions';

export default function ResourceListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <ResourceListContent />
    </Suspense>
  );
}

async function ResourceListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { resources, userPermissions } = await getResourceListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('resource')}
        src={resources}
        permissions={userPermissions}
        basePath="/resource"
        removeAction={removeResource}
      />
    </>
  );
}
