import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getPermissionListPageData } from '@/lib/permission/getters';
import { removePermission } from '@/lib/permission/actions';

export default async function PermissionListPage() {
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  const { permissions, userPermissions } = await getPermissionListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('permission')}
        src={permissions}
        permissions={userPermissions}
        basePath="/permission"
        removeAction={removePermission}
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 200 },
          { field: 'role', headerName: tf('role'), width: 200 }
        ]}
      />
    </>
  );
}
