import FormUpsert from '@/components/user_account/FormUpsert';
import { getAllRoles } from '@/lib/role/getters';

export default async function AddUserAccountPage() {
  const allRoles = await getAllRoles();
  const src = {
    id: '',
    name: '',
    email: '',
    password: '',
    api_key: '',
    avatar: '',
    roles: [],
  };
  return <FormUpsert src={src} isEdit={false} allRoles={allRoles} />;
}
