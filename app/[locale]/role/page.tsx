import { getRoleListPageData } from '@/lib/role/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeRole } from '@/lib/role/actions';

export default async function RolesPage() {
  const { roles, userPermissions } = await getRoleListPageData();
  return <ResponsiveListClient src={roles} basePath="/role" removeAction={removeRole} entityLabel="Role"
    permissions={userPermissions} />;
}
