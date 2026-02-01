import { getAllUserAccounts } from '@/lib/user_account/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeUserAccount } from '@/lib/user_account/actions';

export default async function UserAccountsPage() {
  const user_accounts = await getAllUserAccounts();
  return <DataGridClient src={user_accounts} basePath="/user_account" removeAction={removeUserAccount} entityLabel="User Account" displayFields={[
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'email', headerName: 'Email', width: 400 }
  ]} />;
}
