import { getUserAccountListPageData } from '@/lib/user_account/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeUserAccount } from '@/lib/user_account/actions';

export default async function UserAccountsPage() {
  const { userAccounts, permissions } = await getUserAccountListPageData();
  return (
    <DataGridClient
      src={userAccounts}
      basePath="/user_account"
      removeAction={removeUserAccount}
      entityLabel="User Account"
      displayFields={[
        { field: 'name', headerName: 'Name', width: 150 },
        { field: 'email', headerName: 'Email', width: 400 }
      ]}
      canCreate={permissions.create}
      canEdit={permissions.update}
      canDelete={permissions.delete}
    />
  );
}
