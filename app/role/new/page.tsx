import FormUpsert from '@/components/role/FormUpsert';
import { getRoleNewPageData } from '@/lib/role/getters';

export default async function AddRolePage() {
  const { allUserAccounts } = await getRoleNewPageData();
  const src = {
    id: '',
    name: '',
    description: '',
    user_accounts: [],
  };
  return <FormUpsert src={src} isEdit={false} allUserAccounts={allUserAccounts} />;
}
