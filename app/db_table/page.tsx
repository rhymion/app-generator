import { getDbTableListPageData } from '@/lib/db_table/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeDbTable } from '@/lib/db_table/actions';

export default async function DbTablesPage() {
  const { dbTables, userPermissions } = await getDbTableListPageData();
  return <DataGridClient src={dbTables} basePath="/db_table" removeAction={removeDbTable} entityLabel="Db Table" 
    permissions={userPermissions} />;
}
