import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/work/FormView';
import { getWorkDetailPageData } from '@/lib/work/getters';
import { WorkDetailPageProps } from '@/lib/work/types';
import { notFound } from 'next/navigation';

export default async function ViewWorkPage({ params }: WorkDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <WorkViewContent id={id} />
    </Suspense>
  );
}

async function WorkViewContent({ id }: { id: string }) {
  const { work, userPermissions } = await getWorkDetailPageData(id);
  if (!work) {
    notFound();
  }
  return <FormView src={work} permissions={userPermissions} />;
}
