'use client';

import { useState } from 'react';
import { GridColDef, GridRowsProp } from '@mui/x-data-grid';
import TextField from '@mui/material/TextField';
import { upsertDbTable, removeDbTable } from '@/lib/db_table/actions';
import type { FormUpsertProps } from '@/lib/db_table/types';
import FormWithChildGrid from '../FormWithChildGrid';
import FieldsDataGrid from '../FieldsDataGrid';

export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const [name, setName] = useState(src.name);
  const [description, setDescription] = useState(src.description || '');
  const [fields, setFields] = useState<GridRowsProp>(
    src.fields.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` }))
  );

  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Name', width: 150, editable: true },
    { field: 'type', headerName: 'Type', width: 100, editable: true },
    { field: 'max_length', headerName: 'Max Length', width: 120, editable: true, type: 'number' },
    { field: 'max', headerName: 'Max', width: 100, editable: true, type: 'number' },
    { field: 'regex', headerName: 'Regex', width: 150, editable: true },
    { field: 'required', headerName: 'Required', width: 100, editable: true, type: 'boolean' },
  ];

  const addField = () => {
    const newField = {
      id: `temp-${Date.now()}-${Math.random()}`,
      name: '',
      type: 'string',
      table_id: src.id,
      max_length: null,
      max: null,
      regex: null,
      required: false,
    };
    setFields(prev => [...prev, newField]);
  };

  const handleSubmit = async (formData: FormData) => {
    formData.set('name', name);
    formData.set('description', description);
    if (isEdit) {
      formData.set('id', src.id);
    }
    // Serialize fields
    fields.forEach((field) => {
      formData.append(
        'fields[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
          name: field.name,
          type: field.type,
          max_length: field.max_length,
          max: field.max,
          regex: field.regex,
          required: field.required,
        })
      );
    });
    await upsertDbTable(formData);
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeDbTable(formData);
  };

  const handleBack = () => {
    window.location.href = '/db_table';
  };

  const formFields = (
    <>
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      <TextField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        fullWidth
        margin="normal"
      />
      <FieldsDataGrid
        fields={fields}
        onFieldsChange={setFields}
        columns={columns}
        onAddField={addField}
        addButtonLabel="Add Field"
        deleteDialogTitle="Delete Selected Fields?"
        deleteDialogMessage="Are you sure you want to delete the selected field(s)? This action cannot be undone."
        showTitle={true}
        title="Fields"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} DB Table`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Table"
      submitButtonLabel="Save"
    />
  );
}