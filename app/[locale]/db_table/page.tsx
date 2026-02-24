import { getDbTableListPageData } from '@/lib/db_table/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeDbTable } from '@/lib/db_table/actions';

export default async function DbTablesPage() {
  const { dbTables, userPermissions } = await getDbTableListPageData();
  return <ResponsiveListClient src={dbTables} basePath="/db_table" removeAction={removeDbTable} entityLabel="Db Table"
    permissions={userPermissions} />;
}
