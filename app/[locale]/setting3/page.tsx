import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getSetting3ListPageData } from '@/lib/setting3/getters';
import { removeSetting3 } from '@/lib/setting3/actions';

export default function Setting3ListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <Setting3ListContent />
    </Suspense>
  );
}

async function Setting3ListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { setting3s, userPermissions } = await getSetting3ListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('setting3')}
        src={setting3s}
        permissions={userPermissions}
        basePath="/setting3"
        removeAction={removeSetting3}
      />
    </>
  );
}
