import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/dashboard/FormView';
import { getDashboardDetailPageData } from '@/lib/dashboard/getters';
import { DashboardDetailPageProps } from '@/lib/dashboard/types';
import { notFound } from 'next/navigation';
import { getUserRoleIds, getSessionUserId } from '@/lib/authz';

export default async function ViewDashboardPage({ params }: DashboardDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <DashboardViewContent id={id} />
    </Suspense>
  );
}

async function DashboardViewContent({ id }: { id: string }) {
  const [{ dashboard, userPermissions }, currentUserRoleIds, currentUserId] = await Promise.all([
    getDashboardDetailPageData(id),
    getUserRoleIds(),
    getSessionUserId(),
  ]);
  if (!dashboard) {
    notFound();
  }
  return <FormView src={dashboard} permissions={userPermissions} currentUserRoleIds={currentUserRoleIds} currentUserId={currentUserId} />;
}
