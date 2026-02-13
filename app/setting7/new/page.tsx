import FormUpsert from '@/components/setting7/FormUpsert';
import { getSetting7NewPageAccessCheck } from '@/lib/setting7/getters';

export default async function AddSetting7Page() {
  const userPermissions =await getSetting7NewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    email: '',
    password: '',
    api_key: '',
    avatar: '',
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
