import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/organization/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getOrganizationNewPageAccessCheck } from '@/lib/organization/getters';

export default function AddOrganizationPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <OrganizationNewContent />
    </Suspense>
  );
}

async function OrganizationNewContent() {
  const [userPermissions, userAccountsData] = await Promise.all([
    getOrganizationNewPageAccessCheck(),
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
