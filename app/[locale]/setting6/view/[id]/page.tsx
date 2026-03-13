import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/setting6/FormView';
import { getSetting6DetailPageData } from '@/lib/setting6/getters';
import { Setting6DetailPageProps } from '@/lib/setting6/types';
import { notFound } from 'next/navigation';

export default async function ViewSetting6Page({ params }: Setting6DetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <Setting6ViewContent id={id} />
    </Suspense>
  );
}

async function Setting6ViewContent({ id }: { id: string }) {
  const { setting6, userPermissions } = await getSetting6DetailPageData(id);
  if (!setting6) {
    notFound();
  }
  return <FormView src={setting6} permissions={userPermissions} />;
}
