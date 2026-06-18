import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/plan/FormUpsert';
import { getPlanDetailPageData } from '@/lib/plan/getters';
import { searchUserOptions } from '@/lib/user/getters';
import { PlanDetailPageProps } from '@/lib/plan/types';
import { notFound } from 'next/navigation';

export default async function EditPlanPage({ params }: PlanDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <PlanEditContent id={id} />
    </Suspense>
  );
}

async function PlanEditContent({ id }: { id: string }) {
  const [detail, initialUsers] = await Promise.all([
    getPlanDetailPageData(id, 'update'),
    searchUserOptions('', [], 50),
  ]);
  if (!detail.plan) {
    notFound();
  }
  return <FormUpsert src={detail.plan} isEdit={true} permissions={detail.userPermissions} initialUsers={ initialUsers } searchUserOptions={ searchUserOptions } />;
}
