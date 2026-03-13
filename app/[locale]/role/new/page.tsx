import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/role/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getRoleNewPageAccessCheck } from '@/lib/role/getters';

export default function AddRolePage() {
  return (
    <Suspense fallback={<Loading />}>
      <RoleNewContent />
    </Suspense>
  );
}

async function RoleNewContent() {
  const [userPermissions, userAccountsData] = await Promise.all([
    getRoleNewPageAccessCheck(),
    getUserAccountListPageData(false),
  ]);
  const src = {
    id: '',
    name: '',
    description: '',
    user_accounts: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
