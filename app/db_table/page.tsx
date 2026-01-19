import { getAllDbTables } from '@/lib/db_table/getters';
import DbTableClient from '@/components/db_table/DbTableClient';
import Link from 'next/link';
import Button from '@mui/material/Button';

export default async function DbTablesPage() {
  const db_tables = await getAllDbTables();
  return <DbTableClient src={db_tables} />;
}