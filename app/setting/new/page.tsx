import FormUpsert from '@/components/setting/FormUpsert';
import { getSettingNewPageAccessCheck } from '@/lib/setting/getters';

export default async function AddSettingPage() {
  const userPermissions =await getSettingNewPageAccessCheck();
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
