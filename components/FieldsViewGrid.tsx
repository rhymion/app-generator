'use client';

import { useState } from 'react';
import { DataGrid, GridColDef, GridRowsProp } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';

interface FieldsViewGridProps {
  fields: GridRowsProp;
  columns: GridColDef[];
}

export default function FieldsViewGrid({ fields, columns }: FieldsViewGridProps) {
  const [paginationModel, setPaginationModel] = useState({
    pageSize: 10,
    page: 0,
  });

  return (
    <Paper sx={{ height: 400, width: '100%' }}>
      <DataGrid
        rows={fields}
        columns={columns}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={[10, 20, 50]}
      />
    </Paper>
  );
}
