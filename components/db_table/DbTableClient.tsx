'use client';
import { useState, useTransition } from 'react';
import { DataGrid, GridColDef, useGridApiRef } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import { removeDbTable } from '@/lib/db_table/actions';
import type { DbTable } from '@/lib/db_table/types';
import { tab } from '@testing-library/user-event/dist/cjs/convenience/tab.js';

const paginationModel = { page: 0, pageSize: 5 };

interface DbTableClientProps {
  src: DbTable[];
}

export default function DbTableClient({ src }: DbTableClientProps) {
  const [tables, setTables] = useState(src);
  const [isPending, startTransition] = useTransition();
  const apiRef = useGridApiRef();

  function moveRowUp(index: number) {
    setTables(prev => {
      const newTables = [...prev];
      [newTables[index - 1], newTables[index]] = [newTables[index], newTables[index - 1]];
      return newTables;
    });
  }

  function moveRowDown(index: number) {
    setTables(prev => {
      const newTables = [...prev];
      [newTables[index], newTables[index + 1]] = [newTables[index + 1], newTables[index]];
      return newTables;
    });
  }

  const deleteSelected = () => {
    const selectedRows = apiRef.current?.getSelectedRows() || new Map();
    const selectedIds = Array.from(selectedRows.keys());
    if (selectedIds.length > 0) {
      startTransition(() => removeDbTable(selectedIds));
    }
  };

  const deleteTable = (id: string) => {
    const formData = new FormData();
    formData.set('id', id);
    startTransition(() => removeDbTable(formData));
  };

  const renderActions = (params: any) => {
    const index = tables.findIndex(t => t.id === params.id);
    return (
      <>
        <Button size="small" disabled={index === 0} onClick={() => moveRowUp(index)}>↑</Button>
        <Button size="small" disabled={index === tables.length - 1} onClick={() => moveRowDown(index)}>↓</Button>
        <Button size="small" color="error" onClick={() => deleteTable(params.id)}>Delete</Button>
      </>
    );
  };

  const columns: GridColDef<DbTable>[] = [
    {
      field: 'name',
      headerName: 'Name',
      width: 150,
      renderCell: (params) => {
        return <Link href={`/db_table/view/${params.id}`}>{params.row.name}</Link>;
      },
    },
    {
      field: 'description',
      headerName: 'Description',
      width: 400,
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 300,
      renderCell: renderActions,
    },
  ];

  return (
    <div>
      <div className="flex mb-4">
        <Link href="/db_table/new">
          <Button variant="contained">Create New Table</Button>
        </Link>
        <Button onClick={deleteSelected} variant="contained" color="error" sx={{ mx: 2 }}>Delete Selected</Button>
      </div>
      <Paper sx={{ height: 500, width: '100%' }}>
        <DataGrid
          apiRef={apiRef}
          rows={tables}
          columns={columns}
          initialState={{ pagination: { paginationModel } }}
          pageSizeOptions={[10, 20]}
          checkboxSelection
          sx={{ border: 0 }}
        />
      </Paper>
    </div>
  );
}