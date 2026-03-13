import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/setting5/FormView';
import { getSetting5DetailPageData } from '@/lib/setting5/getters';
import { Setting5DetailPageProps } from '@/lib/setting5/types';
import { notFound } from 'next/navigation';

export default async function ViewSetting5Page({ params }: Setting5DetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <Setting5ViewContent id={id} />
    </Suspense>
  );
}

async function Setting5ViewContent({ id }: { id: string }) {
  const { setting5, userPermissions } = await getSetting5DetailPageData(id);
  if (!setting5) {
    notFound();
  }
  return <FormView src={setting5} permissions={userPermissions} />;
}
