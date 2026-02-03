import FormUpsert from '@/components/user_account/FormUpsert';
import { getUserAccountNewPageData } from '@/lib/user_account/getters';

export default async function AddUserAccountPage() {
  const { allRoles, canAssignRoles } = await getUserAccountNewPageData();
  const src = {
    id: '',
    name: '',
    email: '',
    password: '',
    api_key: '',
    avatar: '',
    roles: [],
  };
  return <FormUpsert src={src} isEdit={false} allRoles={allRoles} allowRoleEdit={canAssignRoles} />;
}
