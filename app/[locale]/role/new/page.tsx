import FormUpsert from '@/components/role/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getRoleNewPageAccessCheck } from '@/lib/role/getters';

export default async function AddRolePage() {
  const userAccountsData = await getUserAccountListPageData(false);
  const userPermissions = await getRoleNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    user_accounts: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
