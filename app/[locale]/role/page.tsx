import { getTranslations } from 'next-intl/server';
import { getRoleListPageData } from '@/lib/role/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeRole } from '@/lib/role/actions';

export default async function RolesPage() {
  const { roles, userPermissions } = await getRoleListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={roles} basePath="/role" removeAction={removeRole} entityLabel={t('role')}
    permissions={userPermissions} />;
}
