import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/plan/FormView';
import { getPlanDetailPageData } from '@/lib/plan/getters';
import { PlanDetailPageProps } from '@/lib/plan/types';
import { notFound } from 'next/navigation';

export default async function ViewPlanPage({ params }: PlanDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <PlanViewContent id={id} />
    </Suspense>
  );
}

async function PlanViewContent({ id }: { id: string }) {
  const { plan, userPermissions } = await getPlanDetailPageData(id);
  if (!plan) {
    notFound();
  }
  return <FormView src={plan} permissions={userPermissions} />;
}
