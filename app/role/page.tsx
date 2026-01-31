import { getAllRoles } from '@/lib/role/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeRole } from '@/lib/role/actions';

export default async function RolesPage() {
  const roles = await getAllRoles();
  return <DataGridClient src={roles} basePath="/role" removeAction={removeRole} entityLabel="Role" />;
}
