import FormUpsert from '@/components/procedure/FormUpsert';
import { getProcedureListPageData } from '@/lib/procedure/getters';
import { getProcedureNewPageAccessCheck } from '@/lib/procedure/getters';

export default async function AddProcedurePage() {
  const proceduresData = await getProcedureListPageData(false);
  const userPermissions =await getProcedureNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    preceded_by: [],
    followed_by: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allProcedures={proceduresData.procedures} procedurePermissions={proceduresData.userPermissions} />;
}
