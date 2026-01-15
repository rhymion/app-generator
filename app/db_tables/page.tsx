import { getAllDbTables } from '@/lib/db_tables/getters';
import DbTablesClient from '@/components/DbTablesClient';

export default async function DbTablesPage() {
  const db_tables = await getAllDbTables();
  return <DbTablesClient dbTables={db_tables} />;
}