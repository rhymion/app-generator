import FormUpsert from '@/components/permission/FormUpsert';
import { getAllRoles } from '@/lib/role/getters';

export default async function AddPermissionPage() {
  const allRoles = await getAllRoles();
  const src = {
    id: '',
    name: '',
    create: null,
    read: null,
    update: null,
    remove: null,
    role_id: '',
  };
  return <FormUpsert src={src} isEdit={false} allRoles={allRoles} />;
}
