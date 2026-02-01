import FormView from '@/components/organization/FormView';
import { getOrganizationDetail } from '@/lib/organization/getters';
import { OrganizationDetailPageProps } from '@/lib/organization/types';
import { notFound } from 'next/navigation';

export default async function ViewOrganizationPage({ params }: OrganizationDetailPageProps) {
  const { id } = await params;
  const organization = await getOrganizationDetail(id);
  if (!organization) {
    notFound();
  }
  return <FormView src={organization} />;
}
