import FormUpsert from '@/components/shift_template/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getShiftTemplateNewPageAccessCheck } from '@/lib/shift_template/getters';

export default async function AddShiftTemplatePage() {
  const userAccountsData = await getUserAccountListPageData(false);
  const userPermissions =await getShiftTemplateNewPageAccessCheck();
  const src = {
    id: '',
    user_account_id: '',
    day_of_week: 0,
    start_time: null,
    end_time: null,
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
