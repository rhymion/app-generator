import FormUpsert from '@/components/parent1/FormUpsert';
import { getParent1DetailPageData } from '@/lib/parent1/getters';
import { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';
import { Parent1DetailPageProps } from '@/lib/parent1/types';
import { notFound } from 'next/navigation';

export default async function EditParent1Page({ params }: Parent1DetailPageProps) {
  const { id } = await params;
  const [detail, organizationsData] = await Promise.all([
    getParent1DetailPageData(id, 'update'),
    getAssociatedOrganizationListPageData(),
  ]);
  if (!detail.parent1) {
    notFound();
  }
  return <FormUpsert src={detail.parent1} isEdit={true} allOrganizations={organizationsData.organizations} organizationPermissions={organizationsData.userPermissions} />;
}
