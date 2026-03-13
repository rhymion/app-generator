import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getSetting2ListPageData } from '@/lib/setting2/getters';

export default function Setting2ListPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Setting2ListContent />
    </Suspense>
  );
}

async function Setting2ListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { setting2s, userPermissions } = await getSetting2ListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('setting2')}
        src={setting2s}
        permissions={userPermissions}
        basePath="/setting2"
      />
    </>
  );
}
