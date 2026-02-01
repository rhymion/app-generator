import FormUpsert from '@/components/organization/FormUpsert';
import { getOrganizationDetail } from '@/lib/organization/getters';
import { getAllUserAccounts } from '@/lib/user_account/getters';
import { OrganizationDetailPageProps } from '@/lib/organization/types';
import { notFound } from 'next/navigation';

export default async function EditOrganizationPage({ params }: OrganizationDetailPageProps) {
  const { id } = await params;
  const [organization, allUserAccounts] = await Promise.all([
    getOrganizationDetail(id),
    getAllUserAccounts(),
  ]);
  if (!organization) {
    notFound();
  }
  return <FormUpsert src={organization} isEdit={true} allUserAccounts={allUserAccounts} />;
}
