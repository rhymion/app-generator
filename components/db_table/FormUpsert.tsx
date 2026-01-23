'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { GridRowsProp } from '@mui/x-data-grid';
import TextField from '@mui/material/TextField';
import { upsertDbTable, removeDbTable } from '@/lib/db_table/actions';
import type { FormUpsertProps } from '@/lib/db_table/types';
import FormWithChildGrid from '../FormWithChildGrid';
import FieldsDataGrid from '../FieldsDataGrid';
import { field_columns } from '../db_table/column_def';

export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fieldsGridRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const columns = field_columns(true);

  const initialFields = src.fields.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` }));

  const createNewField = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    type: 'string',
    table_id: src.id,
    max_length: null,
    max: null,
    regex: null,
    required: false,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    const formData = new FormData();
    const name = nameRef.current?.value || '';
    const description = descriptionRef.current?.value || '';
    const fields = fieldsGridRef.current?.getFields?.() || [];

    formData.set('id', src.id);
    formData.set('name', name);
    formData.set('description', description);

    // Serialize fields
    (fields as any[]).forEach((field) => {
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

    try {
      startTransition(async () => {
        await upsertDbTable(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeDbTable(formData);
    router.push('/db_table');
    router.refresh();
  };

  const handleBack = () => {
    router.push('/db_table');
    router.refresh();
  };

  const formFields = (
    <>
      <TextField
        label="Name"
        inputRef={nameRef}
        defaultValue={src.name}
        fullWidth
        margin="normal"
        required
      />
      <TextField
        label="Description"
        inputRef={descriptionRef}
        defaultValue={src.description || ''}
        fullWidth
        margin="normal"
        multiline
        rows={4}
      />
      <FieldsDataGrid
        ref={fieldsGridRef}
        initialFields={initialFields}
        columns={columns}
        createNewRow={createNewField}
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
      error={error}
    />
  );
}