import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/shift/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getShiftNewPageAccessCheck } from '@/lib/shift/getters';

export default function AddShiftPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ShiftNewContent />
    </Suspense>
  );
}

async function ShiftNewContent() {
  const [userPermissions, userAccountsData] = await Promise.all([
    getShiftNewPageAccessCheck(),
    getUserAccountListPageData(false),
  ]);
  const src = {
    id: '',
    user_account_id: '',
    start_time: null,
    end_time: null,
    status: 0,
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
