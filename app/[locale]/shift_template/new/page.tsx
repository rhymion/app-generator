import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/shift_template/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getShiftTemplateNewPageAccessCheck } from '@/lib/shift_template/getters';

export default function AddShiftTemplatePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ShiftTemplateNewContent />
    </Suspense>
  );
}

async function ShiftTemplateNewContent() {
  const [userPermissions, userAccountsData] = await Promise.all([
    getShiftTemplateNewPageAccessCheck(),
    getUserAccountListPageData(false),
  ]);
  const src = {
    id: '',
    user_account_id: '',
    day_of_week: 0,
    start_time: null,
    end_time: null,
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
