import FormUpsert from '@/components/permission/FormUpsert';
import { getRoleListPageData } from '@/lib/role/getters';
import { getPermissionNewPageAccessCheck } from '@/lib/permission/getters';

export default async function AddPermissionPage() {
  const rolesData = await getRoleListPageData(false);
  await getPermissionNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    create: false,
    read: false,
    update: false,
    delete: false,
    role_id: '',
  };
  return <FormUpsert src={src} isEdit={false} allRoles={rolesData.roles} rolePermissions={rolesData.userPermissions} />;
}
