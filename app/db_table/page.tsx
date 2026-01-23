import { getAllDbTables } from '@/lib/db_table/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeDbTable } from '@/lib/db_table/actions';

export default async function DbTablesPage() {
  const db_tables = await getAllDbTables();
  return <DataGridClient src={db_tables} basePath="/db_table" removeAction={removeDbTable} entityLabel="Table" />;
}