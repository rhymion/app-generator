import FormView from '@/components/organization/FormView';
import { getOrganizationDetailPageData } from '@/lib/organization/getters';
import { OrganizationDetailPageProps } from '@/lib/organization/types';
import { notFound } from 'next/navigation';

export default async function ViewOrganizationPage({ params }: OrganizationDetailPageProps) {
  const { id } = await params;
  const { organization, userPermissions } = await getOrganizationDetailPageData(id);
  if (!organization) {
    notFound();
  }
  return <FormView src={organization} permissions={userPermissions} />;
}
