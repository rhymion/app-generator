import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/procedure/FormView';
import { getProcedureDetailPageData } from '@/lib/procedure/getters';
import { ProcedureDetailPageProps } from '@/lib/procedure/types';
import { notFound } from 'next/navigation';

export default async function ViewProcedurePage({ params }: ProcedureDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ProcedureViewContent id={id} />
    </Suspense>
  );
}

async function ProcedureViewContent({ id }: { id: string }) {
  const { procedure, userPermissions } = await getProcedureDetailPageData(id);
  if (!procedure) {
    notFound();
  }
  return <FormView src={procedure} permissions={userPermissions} />;
}
