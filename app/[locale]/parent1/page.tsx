import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getParent1ListPageData } from '@/lib/parent1/getters';
import { removeParent1 } from '@/lib/parent1/actions';

export default function Parent1ListPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Parent1ListContent />
    </Suspense>
  );
}

async function Parent1ListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { parent1s, userPermissions } = await getParent1ListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('parent1')}
        src={parent1s}
        permissions={userPermissions}
        basePath="/parent1"
        removeAction={removeParent1}
      />
    </>
  );
}
