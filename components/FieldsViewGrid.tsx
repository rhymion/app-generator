'use client';

import { useState } from 'react';
import { DataGrid, GridColDef, GridRowsProp } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import useMediaQuery from '@mui/material/useMediaQuery';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

interface FieldsViewGridProps {
  fields: GridRowsProp;
  columns: GridColDef[];
}

function getDisplayValue(col: GridColDef, row: any): string {
  const rawValue = row[col.field];
  if (col.valueGetter) {
    const result = (col.valueGetter as Function)(rawValue, row, col, null);
    if (result === null || result === undefined) return '';
    if (col.valueFormatter) {
      const formatted = (col.valueFormatter as Function)(result, row, col, null);
      return formatted === null || formatted === undefined ? '' : String(formatted);
    }
    return String(result);
  }
  if (col.type === 'boolean') return Boolean(rawValue) ? 'Yes' : 'No';
  if (rawValue === null || rawValue === undefined) return '';
  if (col.valueFormatter) {
    const formatted = (col.valueFormatter as Function)(rawValue, row, col, null);
    return formatted === null || formatted === undefined ? '' : String(formatted);
  }
  return String(rawValue);
}

export default function FieldsViewGrid({ fields, columns }: FieldsViewGridProps) {
  const [paginationModel, setPaginationModel] = useState({
    pageSize: 10,
    page: 0,
  });
  const isMobile = useMediaQuery('(max-width: 768px)');

  if (isMobile) {
    const displayColumns = columns.filter(col => col.field !== 'id');
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {fields.length === 0 ? (
          <Typography color="text.secondary">No items.</Typography>
        ) : (
          fields.map((row, index) => (
            <Card key={row.id ?? index} variant="outlined">
              <CardContent sx={{ pb: '8px !important' }}>
                {displayColumns.map(col => {
                  const displayValue = getDisplayValue(col, row);
                  if (!displayValue) return null;
                  return (
                    <Box key={col.field} sx={{ mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" component="span">
                        {col.headerName}:{' '}
                      </Typography>
                      <Typography variant="body2" component="span">
                        {displayValue}
                      </Typography>
                    </Box>
                  );
                })}
              </CardContent>
            </Card>
          ))
        )}
      </Box>
    );
  }

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
