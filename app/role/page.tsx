import { getRoleListPageData } from '@/lib/role/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeRole } from '@/lib/role/actions';

export default async function RolesPage() {
  const { roles, permissions } = await getRoleListPageData();
  return (
    <DataGridClient
      src={roles}
      basePath="/role"
      removeAction={removeRole}
      entityLabel="Role"
      canCreate={permissions.create}
      canEdit={permissions.update}
      canDelete={permissions.delete}
    />
  );
}
