import FormUpsert from '@/components/user_account/FormUpsert';
import { getRoleListPageData } from '@/lib/role/getters';
import { getUserAccountNewPageAccessCheck } from '@/lib/user_account/getters';

export default async function AddUserAccountPage() {
  const rolesData = await getRoleListPageData(false);
  const userPermissions =await getUserAccountNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    email: '',
    password: '',
    api_key: '',
    avatar: '',
    roles: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allRoles={rolesData.roles} rolePermissions={rolesData.userPermissions} />;
}
