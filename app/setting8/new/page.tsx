import FormUpsert from '@/components/setting8/FormUpsert';
import { getSetting8NewPageAccessCheck } from '@/lib/setting8/getters';

export default async function AddSetting8Page() {
  const userPermissions =await getSetting8NewPageAccessCheck();
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
