import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/tenant/FormView';
import { getTenantDetailPageData } from '@/lib/tenant/getters';
import { TenantDetailPageProps } from '@/lib/tenant/types';
import { notFound } from 'next/navigation';

export default async function ViewTenantPage({ params }: TenantDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <TenantViewContent id={id} />
    </Suspense>
  );
}

async function TenantViewContent({ id }: { id: string }) {
  const { tenant, userPermissions } = await getTenantDetailPageData(id);
  if (!tenant) {
    notFound();
  }
  return <FormView src={tenant} permissions={userPermissions} />;
}
