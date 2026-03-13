import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormView from '@/components/parent_only/FormView';
import { getParentOnlyDetailPageData } from '@/lib/parent_only/getters';
import { ParentOnlyDetailPageProps } from '@/lib/parent_only/types';
import { notFound } from 'next/navigation';

export default async function ViewParentOnlyPage({ params }: ParentOnlyDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <ParentOnlyViewContent id={id} />
    </Suspense>
  );
}

async function ParentOnlyViewContent({ id }: { id: string }) {
  const { parentOnly, userPermissions } = await getParentOnlyDetailPageData(id);
  if (!parentOnly) {
    notFound();
  }
  return <FormView src={parentOnly} permissions={userPermissions} />;
}
