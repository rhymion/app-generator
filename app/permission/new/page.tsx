import FormUpsert from '@/components/permission/FormUpsert';
import { getAllRoles } from '@/lib/role/getters';

export default async function AddPermissionPage() {
  const allRoles = await getAllRoles();
  const src = {
    id: '',
    name: '',
    create: false,
    read: false,
    update: false,
    delete: false,
    role_id: '',
  };
  return <FormUpsert src={src} isEdit={false} allRoles={allRoles} />;
}
