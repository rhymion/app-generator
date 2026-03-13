import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { removeUserAccount } from '@/lib/user_account/actions';

export default function UserAccountListPage() {
  return (
    <Suspense fallback={<Loading />}>
      <UserAccountListContent />
    </Suspense>
  );
}

async function UserAccountListContent() {
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
