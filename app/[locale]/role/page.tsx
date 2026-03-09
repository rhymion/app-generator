import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getRoleListPageData } from '@/lib/role/getters';
import { removeRole } from '@/lib/role/actions';

export default async function RoleListPage() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { roles, userPermissions } = await getRoleListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('role')}
        src={roles}
        permissions={userPermissions}
        basePath="/role"
        removeAction={removeRole}
      />
    </>
  );
}
