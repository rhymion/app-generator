import FormUpsert from '@/components/setting2/FormUpsert';
import { getSetting2NewPageAccessCheck } from '@/lib/setting2/getters';

export default async function AddSetting2Page() {
  const userPermissions =await getSetting2NewPageAccessCheck();
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
