import { getTranslations } from 'next-intl/server';
import { getPermissionListPageData } from '@/lib/permission/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removePermission } from '@/lib/permission/actions';

export default async function PermissionsPage() {
  const { permissions, userPermissions } = await getPermissionListPageData();
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  return <ResponsiveListClient src={permissions} basePath="/permission" removeAction={removePermission} entityLabel={t('permission')} displayFields={[
    { field: 'name', headerName: tf('name'), width: 200 },
    { field: 'role', headerName: tf('role'), width: 200 }
  ]}
    permissions={userPermissions} />;
}
