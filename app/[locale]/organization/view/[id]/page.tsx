import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/organization/FormView';
import { getOrganizationDetailPageData } from '@/lib/organization/getters';
import { OrganizationDetailPageProps } from '@/lib/organization/types';
import { notFound } from 'next/navigation';

export default async function ViewOrganizationPage({ params }: OrganizationDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <OrganizationViewContent id={id} />
    </Suspense>
  );
}

async function OrganizationViewContent({ id }: { id: string }) {
  const { organization, userPermissions } = await getOrganizationDetailPageData(id);
  if (!organization) {
    notFound();
  }
  return <FormView src={organization} permissions={userPermissions} />;
}
