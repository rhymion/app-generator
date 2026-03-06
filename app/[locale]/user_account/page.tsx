import { getTranslations } from 'next-intl/server';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeUserAccount } from '@/lib/user_account/actions';

export default async function UserAccountsPage() {
  const { userAccounts, userPermissions } = await getUserAccountListPageData();
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  return <ResponsiveListClient src={userAccounts} basePath="/user_account" removeAction={removeUserAccount} entityLabel={t('userAccount')} primaryField="name" displayFields={[
    { field: 'name', headerName: tf('name'), width: 150 }
  ]}
    permissions={userPermissions} />;
}
