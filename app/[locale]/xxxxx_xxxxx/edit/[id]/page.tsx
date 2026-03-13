import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/xxxxx_xxxxx/FormUpsert';
import { getXxxxxXxxxxDetailPageData } from '@/lib/xxxxx_xxxxx/getters';
import { XxxxxXxxxxDetailPageProps } from '@/lib/xxxxx_xxxxx/types';
import { notFound } from 'next/navigation';

export default async function EditXxxxxXxxxxPage({ params }: XxxxxXxxxxDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <XxxxxXxxxxEditContent id={id} />
    </Suspense>
  );
}

async function XxxxxXxxxxEditContent({ id }: { id: string }) {
  const detail = await getXxxxxXxxxxDetailPageData(id, 'update');
  if (!detail.xxxxxXxxxx) {
    notFound();
  }
  return <FormUpsert src={detail.xxxxxXxxxx} isEdit={true} permissions={detail.userPermissions} />;
}
