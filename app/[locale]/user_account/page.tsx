import { getUserAccountListPageData } from '@/lib/user_account/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeUserAccount } from '@/lib/user_account/actions';

export default async function UserAccountsPage() {
  const { userAccounts, userPermissions } = await getUserAccountListPageData();
  return <ResponsiveListClient src={userAccounts} basePath="/user_account" removeAction={removeUserAccount} entityLabel="User Account" displayFields={[
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'email', headerName: 'Email', width: 400 }
  ]}
    permissions={userPermissions} />;
}
