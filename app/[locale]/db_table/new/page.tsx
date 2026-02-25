import FormUpsert from '@/components/db_table/FormUpsert';
import { getDbTableListPageData } from '@/lib/db_table/getters';
import { getDbTableNewPageAccessCheck } from '@/lib/db_table/getters';

export default async function AddDbTablePage() {
  const dbTablesData = await getDbTableListPageData(false);
  const userPermissions =await getDbTableNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    fields: [],
    db_table_comments: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allDbTables={dbTablesData.dbTables} dbTablePermissions={dbTablesData.userPermissions} />;
}
