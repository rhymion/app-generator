'use client';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import type { DbTable } from '@/lib/db_tables/types';

const columns: GridColDef<DbTable>[] = [
  { field: 'id', headerName: 'ID', width: 90 },
  {
    field: 'name',
    headerName: 'Name',
    width: 150,
  },
  {
    field: 'description',
    headerName: 'Description',
    width: 300,
  },
];

const paginationModel = { page: 0, pageSize: 5 };

interface DbTablesClientProps {
  dbTables: DbTable[];
}

export default function DbTablesClient({ dbTables }: DbTablesClientProps) {
  return (
    <Paper sx={{ height: 400, width: '100%' }}>
      <DataGrid
        rows={dbTables}
        columns={columns}
        initialState={{ pagination: { paginationModel } }}
        pageSizeOptions={[5, 10]}
        checkboxSelection
        sx={{ border: 0 }}
      />
    </Paper>
  );
}