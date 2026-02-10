'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertDbTable, removeDbTable } from '@/lib/db_table/actions';
import type { FormUpsertProps } from '@/lib/db_table/types';
import FormWithChildGrid from '../FormWithChildGrid';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '../FieldsDataGrid';
  import { fields_columns } from '../db_table/column_def';

export default function FormUpsert({ src, isEdit, permissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const fieldsRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const fieldsColumns = fields_columns(true);

  const initialFields = src.fields.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` }));

  const createNewFields = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    type: '',
    max_length: null,
    max: null,
    regex: '',
    required: true,
    db_table_id: src.id,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    const fields = fieldsRef.current?.getFields?.() || [];

    (fields as any[]).forEach((field) => {
      formData.append(
        'field[]',
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
        defaultValue={src.name || ''}
        fullWidth
        margin="normal"
        required
        slotProps={ { htmlInput: { minLength: 1 } } }
        multiline={false}
        rows={undefined}
      />
      <TextField
        label="Description"
        inputRef={descriptionRef}
        defaultValue={src.description || ''}
        fullWidth
        margin="normal"
        
        multiline={true}
        rows={4}
      />
      <FieldsDataGrid
        ref={fieldsRef}
        initialFields={initialFields}
        columns={fieldsColumns}
        createNewRow={createNewFields}
        addButtonLabel="Add Fields"
        deleteDialogTitle="Delete Selected Fields?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="Fields"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Db Table`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit && canDelete ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Db Table"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
