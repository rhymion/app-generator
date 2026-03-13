import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/resource/FormUpsert';
import { getResourceDetailPageData } from '@/lib/resource/getters';
import { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';
import { ResourceDetailPageProps } from '@/lib/resource/types';
import { notFound } from 'next/navigation';

export default async function EditResourcePage({ params }: ResourceDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <ResourceEditContent id={id} />
    </Suspense>
  );
}

async function ResourceEditContent({ id }: { id: string }) {
  const [detail, organizationsData] = await Promise.all([
    getResourceDetailPageData(id, 'update'),
    getAssociatedOrganizationListPageData(),
  ]);
  if (!detail.resource) {
    notFound();
  }
  return <FormUpsert src={detail.resource} isEdit={true} permissions={detail.userPermissions} allOrganizations={organizationsData.organizations} organizationPermissions={organizationsData.userPermissions} />;
}
