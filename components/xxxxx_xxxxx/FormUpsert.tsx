'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertXxxxxXxxxx, removeXxxxxXxxxx } from '@/lib/xxxxx_xxxxx/actions';
import type { FormUpsertProps } from '@/lib/xxxxx_xxxxx/types';
import FormWithChildGrid from '../FormWithChildGrid';
import { GridRowsProp } from '@mui/x-data-grid';
import FieldsDataGrid from '../FieldsDataGrid';
import { yyyyy_yyyyy_columns } from '../xxxxx_xxxxx/column_def';

export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);


  const yyyyy_yyyyyGridRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const teamRef = useRef<HTMLInputElement>(null);
  const yyyyy_yyyyyColumns = yyyyy_yyyyy_columns(true);

  const initialYyyyyYyyyy = src.yyyyy_yyyyys.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` }));

  const createNewYyyyyYyyyy = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    type: 'string',
    max_length: null,
    max: null,
    regex: '',
    required: true,
    written_by: '',
    xxxxx_xxxxx_id: src.id,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    formData.set('team', teamRef.current?.value || '');
    const yyyyyYyyyy = yyyyy_yyyyyGridRef.current?.getFields?.() || [];

    (yyyyyYyyyy as any[]).forEach((field) => {
      formData.append(
        'yyyyyYyyyy[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
          name: field.name,
          type: field.type,
          max_length: field.max_length,
          max: field.max,
          regex: field.regex,
          required: field.required,
          written_by: field.written_by,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertXxxxxXxxxx(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeXxxxxXxxxx(formData);
  };

  const handleBack = () => {
    router.push('/xxxxx_xxxxx');
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
      <TextField
        label="Team"
        inputRef={teamRef}
        defaultValue={src.team || ''}
        fullWidth
        margin="normal"
        
        multiline={false}
        rows={undefined}
      />      <FieldsDataGrid
        ref={yyyyy_yyyyyGridRef}
        initialFields={initialYyyyyYyyyy}
        columns={yyyyy_yyyyyColumns}
        createNewRow={createNewYyyyyYyyyy}
        addButtonLabel="Add Yyyyy Yyyyy"
        deleteDialogTitle="Delete Selected Yyyyy Yyyyy?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="Yyyyy Yyyyy"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Xxxxx Xxxxx`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Xxxxx Xxxxx"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
