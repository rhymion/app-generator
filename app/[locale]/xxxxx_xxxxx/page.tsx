import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getXxxxxXxxxxListPageData } from '@/lib/xxxxx_xxxxx/getters';
import { removeXxxxxXxxxx } from '@/lib/xxxxx_xxxxx/actions';

export default function XxxxxXxxxxListPage() {
  return (
    <Suspense fallback={<Loading />}>
      <XxxxxXxxxxListContent />
    </Suspense>
  );
}

async function XxxxxXxxxxListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { xxxxxXxxxxs, userPermissions } = await getXxxxxXxxxxListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('xxxxxXxxxx')}
        src={xxxxxXxxxxs}
        permissions={userPermissions}
        basePath="/xxxxx_xxxxx"
        removeAction={removeXxxxxXxxxx}
      />
    </>
  );
}
