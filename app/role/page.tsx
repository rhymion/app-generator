import { getRoleListPageData } from '@/lib/role/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeRole } from '@/lib/role/actions';

export default async function RolesPage() {
  const { roles, userPermissions } = await getRoleListPageData();
  return <DataGridClient src={roles} basePath="/role" removeAction={removeRole} entityLabel="Role" 
    permissions={userPermissions} />;
}
