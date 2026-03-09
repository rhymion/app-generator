import FormUpsert from '@/components/parent_only/FormUpsert';
import { getParentOnlyNewPageAccessCheck } from '@/lib/parent_only/getters';

export default async function AddParentOnlyPage() {
  const userPermissions = await getParentOnlyNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    login_time: null,
    logout_time: null,
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
