import FormUpsert from '@/components/procedure/FormUpsert';
import { getProcedureListPageData } from '@/lib/procedure/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getProcedureNewPageAccessCheck } from '@/lib/procedure/getters';

export default async function AddProcedurePage() {
  const proceduresData = await getProcedureListPageData(false);
  const userAccountsData = await getUserAccountListPageData(false);
  const userPermissions = await getProcedureNewPageAccessCheck();
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
