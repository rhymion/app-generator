import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { removeUserAccount } from '@/lib/user_account/actions';

export default async function UserAccountListPage() {
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  const { userAccounts, userPermissions } = await getUserAccountListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('userAccount')}
        src={userAccounts}
        permissions={userPermissions}
        basePath="/user_account"
        removeAction={removeUserAccount}
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 150 }
        ]}
        primaryField="name"
      />
    </>
  );
}
