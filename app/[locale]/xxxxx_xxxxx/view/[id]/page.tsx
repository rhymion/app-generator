import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/xxxxx_xxxxx/FormView';
import { getXxxxxXxxxxDetailPageData } from '@/lib/xxxxx_xxxxx/getters';
import { XxxxxXxxxxDetailPageProps } from '@/lib/xxxxx_xxxxx/types';
import { notFound } from 'next/navigation';

export default async function ViewXxxxxXxxxxPage({ params }: XxxxxXxxxxDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <XxxxxXxxxxViewContent id={id} />
    </Suspense>
  );
}

async function XxxxxXxxxxViewContent({ id }: { id: string }) {
  const { xxxxxXxxxx, userPermissions } = await getXxxxxXxxxxDetailPageData(id);
  if (!xxxxxXxxxx) {
    notFound();
  }
  return <FormView src={xxxxxXxxxx} permissions={userPermissions} />;
}
