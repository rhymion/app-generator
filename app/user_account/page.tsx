import { getAllUserAccounts } from '@/lib/user_account/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeUserAccount } from '@/lib/user_account/actions';

export default async function UserAccountsPage() {
  const user_accounts = await getAllUserAccounts();
  return <DataGridClient src={user_accounts} basePath="/user_account" removeAction={removeUserAccount} entityLabel="User Account" />;
}
