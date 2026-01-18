import { getAllDbTables } from '@/lib/db_table/getters';
import DbTableClient from '@/components/db_table/DbTableClient';
import Link from 'next/link';
import Button from '@mui/material/Button';

export default async function DbTablesPage() {
  const db_tables = await getAllDbTables();
  return <>
    <Link href="/db_table/new" className="btn btn-primary mb-4">
      <Button className="block bg-blue-500 text-white px-4 py-2 my-1 hover:bg-blue-600 transition rounded" variant="contained">Create New Table</Button>
    </Link>
    <DbTableClient src={db_tables} />
  </>;
}