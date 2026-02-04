import { getAllPermissions } from '@/lib/permission/getters';
import DataGridClient from '@/components/DataGridClient';
import { removePermission } from '@/lib/permission/actions';

export default async function PermissionsPage() {
  const permissions = await getAllPermissions();
  return <DataGridClient src={permissions} basePath="/permission" removeAction={removePermission} entityLabel="Permission" displayFields={[
    { field: 'name', headerName: 'Name', width: 200 },
    { field: 'role', headerName: 'Role', width: 200 }
  ]} />;
}
