import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/creator/FormView';
import { getCreatorDetailPageData } from '@/lib/creator/getters';
import { CreatorDetailPageProps } from '@/lib/creator/types';
import { notFound } from 'next/navigation';

export default async function ViewCreatorPage({ params }: CreatorDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <CreatorViewContent id={id} />
    </Suspense>
  );
}

async function CreatorViewContent({ id }: { id: string }) {
  const { creator, userPermissions } = await getCreatorDetailPageData(id);
  if (!creator) {
    notFound();
  }
  return <FormView src={creator} permissions={userPermissions} />;
}
