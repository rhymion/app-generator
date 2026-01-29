import { GridColDef, GridRenderEditCellParams } from '@mui/x-data-grid';
import DateTimeWrapper from '../DateTimeWrapper';
import dayjs from 'dayjs';

export function parent1_child1_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'order', headerName: 'Order', width: 100, editable: false, type: 'number' },
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'type', headerName: 'Type', width: 150, editable: editable },
    { field: 'max_length', headerName: 'Max Length', width: 100, editable: editable, type: 'number' },
    { field: 'max', headerName: 'Max', width: 100, editable: editable, type: 'number' },
    { field: 'regex', headerName: 'Regex', width: 150, editable: editable },
    { field: 'required', headerName: 'Required', width: 100, editable: editable, type: 'boolean' },
    { field: 'written_by', headerName: 'Written By', width: 150, editable: editable },
  ];
}

export function parent1_child2_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'required', headerName: 'Required', width: 100, editable: editable, type: 'boolean' },
    { 
      field: 'start_date', 
      headerName: 'Start Date', 
      width: 250, 
      editable: editable,
      renderEditCell: (params: GridRenderEditCellParams) => (
        <DateTimeWrapper
          label="Start Date"
          date_time={params.value ? new Date(params.value) : null}
          onChange={(newValue: dayjs.Dayjs | null) => {
            params.api.setEditCellValue({ 
              id: params.id, 
              field: params.field, 
              value: newValue ? newValue.toISOString() : '' 
            });
          }}
        />
      ),
      valueFormatter: (value) => {
        if (!value) return '';
        return dayjs(value).format('YYYY-MM-DD HH:mm');
      },
    },
    { 
      field: 'end_date', 
      headerName: 'End Date', 
      width: 250, 
      editable: editable,
      renderEditCell: (params: GridRenderEditCellParams) => (
        <DateTimeWrapper
          label="End Date"
          date_time={params.value ? new Date(params.value) : null}
          onChange={(newValue: dayjs.Dayjs | null) => {
            params.api.setEditCellValue({ 
              id: params.id, 
              field: params.field, 
              value: newValue ? newValue.toISOString() : '' 
            });
          }}
        />
      ),
      valueFormatter: (value) => {
        if (!value) return '';
        return dayjs(value).format('YYYY-MM-DD HH:mm');
      },
    },
  ];
}
