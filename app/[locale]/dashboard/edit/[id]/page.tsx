import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/dashboard/FormUpsert';
import { getDashboardDetailPageData } from '@/lib/dashboard/getters';
import { DashboardDetailPageProps } from '@/lib/dashboard/types';
import { notFound } from 'next/navigation';

export default async function EditDashboardPage({ params }: DashboardDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <DashboardEditContent id={id} />
    </Suspense>
  );
}

async function DashboardEditContent({ id }: { id: string }) {
  const detail = await getDashboardDetailPageData(id, 'update');
  if (!detail.dashboard) {
    notFound();
  }
  return <FormUpsert src={detail.dashboard} isEdit={true} permissions={detail.userPermissions} />;
}
