import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/procedure/FormUpsert';
import { getProcedureListPageData } from '@/lib/procedure/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getProcedureNewPageAccessCheck } from '@/lib/procedure/getters';

export default function AddProcedurePage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ProcedureNewContent />
    </Suspense>
  );
}

async function ProcedureNewContent() {
  const [userPermissions, proceduresData, userAccountsData] = await Promise.all([
    getProcedureNewPageAccessCheck(),
    getProcedureListPageData(false),
    getUserAccountListPageData(false),
  ]);
  const src = {
    id: '',
    name: '',
    description: '',
    parent_id: '',
    assignee_id: '',
    children: [],
    preceded_by: [],
    followed_by: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allProcedures={proceduresData.procedures} procedurePermissions={proceduresData.userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
