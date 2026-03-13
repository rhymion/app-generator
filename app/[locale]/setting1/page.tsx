import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getSetting1ListPageData } from '@/lib/setting1/getters';
import { removeSetting1 } from '@/lib/setting1/actions';

export default function Setting1ListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <Setting1ListContent />
    </Suspense>
  );
}

async function Setting1ListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { setting1s, userPermissions } = await getSetting1ListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('setting1')}
        src={setting1s}
        permissions={userPermissions}
        basePath="/setting1"
        removeAction={removeSetting1}
      />
    </>
  );
}
