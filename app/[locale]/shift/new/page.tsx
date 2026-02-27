import FormUpsert from '@/components/shift/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getShiftNewPageAccessCheck } from '@/lib/shift/getters';

export default async function AddShiftPage() {
  const userAccountsData = await getUserAccountListPageData(false);
  const userPermissions =await getShiftNewPageAccessCheck();
  const src = {
    id: '',
    user_account_id: '',
    start_time: new Date(),
    end_time: new Date(),
    status: 0,
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
