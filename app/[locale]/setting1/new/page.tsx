import FormUpsert from '@/components/setting1/FormUpsert';
import { getSetting1NewPageAccessCheck } from '@/lib/setting1/getters';

export default async function AddSetting1Page() {
  const userPermissions =await getSetting1NewPageAccessCheck();
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
