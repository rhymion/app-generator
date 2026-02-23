import { getPermissionListPageData } from '@/lib/permission/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removePermission } from '@/lib/permission/actions';

export default async function PermissionsPage() {
  const { permissions, userPermissions } = await getPermissionListPageData();
  return <ResponsiveListClient src={permissions} basePath="/permission" removeAction={removePermission} entityLabel="Permission" displayFields={[
    { field: 'name', headerName: 'Name', width: 200 },
    { field: 'role', headerName: 'Role', width: 200 }
  ]}
    permissions={userPermissions} />;
}
