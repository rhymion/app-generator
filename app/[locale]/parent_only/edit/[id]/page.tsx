import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/parent_only/FormUpsert';
import { getParentOnlyDetailPageData } from '@/lib/parent_only/getters';
import { ParentOnlyDetailPageProps } from '@/lib/parent_only/types';
import { notFound } from 'next/navigation';

export default async function EditParentOnlyPage({ params }: ParentOnlyDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ParentOnlyEditContent id={id} />
    </Suspense>
  );
}

async function ParentOnlyEditContent({ id }: { id: string }) {
  const detail = await getParentOnlyDetailPageData(id, 'update');
  if (!detail.parentOnly) {
    notFound();
  }
  return <FormUpsert src={detail.parentOnly} isEdit={true} permissions={detail.userPermissions} />;
}
