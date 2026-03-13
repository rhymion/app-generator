import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getParentOnlyListPageData } from '@/lib/parent_only/getters';
import { removeParentOnly } from '@/lib/parent_only/actions';

export default function ParentOnlyListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <ParentOnlyListContent />
    </Suspense>
  );
}

async function ParentOnlyListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { parentOnlys, userPermissions } = await getParentOnlyListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('parentOnly')}
        src={parentOnlys}
        permissions={userPermissions}
        basePath="/parent_only"
        removeAction={removeParentOnly}
      />
    </>
  );
}
