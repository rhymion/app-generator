import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/role/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getRoleNewPageAccessCheck } from '@/lib/role/getters';

export default function AddRolePage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
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
