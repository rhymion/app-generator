import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormView from '@/components/setting2/FormView';
import { getSetting2DetailPageData } from '@/lib/setting2/getters';
import { Setting2DetailPageProps } from '@/lib/setting2/types';
import { notFound } from 'next/navigation';

export default async function ViewSetting2Page({ params }: Setting2DetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <Setting2ViewContent id={id} />
    </Suspense>
  );
}

async function Setting2ViewContent({ id }: { id: string }) {
  const { setting2, userPermissions } = await getSetting2DetailPageData(id);
  if (!setting2) {
    notFound();
  }
  return <FormView src={setting2} permissions={userPermissions} />;
}
