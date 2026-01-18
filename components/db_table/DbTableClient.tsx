'use client';
import { useState, useTransition } from 'react';
import { DataGrid, GridColDef, useGridApiRef } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import { removeDbTable } from '@/lib/db_table/actions';
import type { DbTable } from '@/lib/db_table/types';

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
        {index > 0 && (
          <Button size="small" onClick={() => moveRowUp(index)}>↑</Button>
        )}
        {index < tables.length - 1 && (
          <Button size="small" onClick={() => moveRowDown(index)}>↓</Button>
        )}
        <Button size="small" color="error" onClick={() => deleteTable(params.id)}>Delete</Button>
      </>
    );
  };

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
      width: 400,
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 200,
      renderCell: renderActions,
    },
  ];

  return (
    <div>
      <Button onClick={deleteSelected} variant="contained" color="error" sx={{ mb: 2 }}>Delete Selected</Button>
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