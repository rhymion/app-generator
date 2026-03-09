import FormUpsert from '@/components/organization/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getOrganizationNewPageAccessCheck } from '@/lib/organization/getters';

export default async function AddOrganizationPage() {
  const userAccountsData = await getUserAccountListPageData(false);
  const userPermissions = await getOrganizationNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    user_accounts: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
