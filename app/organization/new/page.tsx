import FormUpsert from '@/components/organization/FormUpsert';
import { getAllUserAccounts } from '@/lib/user_account/getters';

export default async function AddOrganizationPage() {
  const allUserAccounts = await getAllUserAccounts();
  const src = {
    id: '',
    name: '',
    description: '',
    user_accounts: [],
  };
  return <FormUpsert src={src} isEdit={false} allUserAccounts={allUserAccounts} />;
}
