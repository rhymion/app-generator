import FormUpsert from '@/components/organization/FormUpsert';
import { getOrganizationDetailPageData } from '@/lib/organization/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { OrganizationDetailPageProps } from '@/lib/organization/types';
import { notFound } from 'next/navigation';

export default async function EditOrganizationPage({ params }: OrganizationDetailPageProps) {
  const { id } = await params;
  const [detail, userAccountsData] = await Promise.all([
    getOrganizationDetailPageData(id, 'update'),
    getUserAccountListPageData(false),
  ]);
  if (!detail.organization) {
    notFound();
  }
  return <FormUpsert src={detail.organization} isEdit={true} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
