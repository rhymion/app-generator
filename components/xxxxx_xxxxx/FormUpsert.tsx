'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertXxxxxXxxxx, removeXxxxxXxxxx } from '@/lib/xxxxx_xxxxx/actions';
import type { FormUpsertProps } from '@/lib/xxxxx_xxxxx/types';
import FormWithChildGrid from '../FormWithChildGrid';
import AuditInfo from '../AuditInfo';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '../FieldsDataGrid';
  import { yyyyy_yyyyys_columns } from '../xxxxx_xxxxx/column_def';

export default function FormUpsert({ src, isEdit, permissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const yyyyyYyyyysRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const teamRef = useRef<HTMLInputElement>(null);
  const yyyyyYyyyysColumns = yyyyy_yyyyys_columns(true);

  const [initialYyyyyYyyyys] = useState<GridRowsProp>(() => src.yyyyy_yyyyys.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` })));

  const createNewYyyyyYyyyys = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    type: '',
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
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    formData.set('team', teamRef.current?.value || '');
    const yyyyyYyyyys = yyyyyYyyyysRef.current?.getFields?.() || [];

    (yyyyyYyyyys as GridRowsProp).forEach((field) => {
      formData.append(
        'yyyyy_yyyyy[]',
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
      />
      <FieldsDataGrid
        ref={yyyyyYyyyysRef}
        initialFields={initialYyyyyYyyyys}
        columns={yyyyyYyyyysColumns}
        createNewRow={createNewYyyyyYyyyys}
        addButtonLabel="Add Yyyyy Yyyyys"
        deleteDialogTitle="Delete Selected Yyyyy Yyyyys?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="Yyyyy Yyyyys"
      />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={`${isEdit ? 'Edit' : 'Add'} Xxxxx Xxxxx`}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel="Xxxxx Xxxxx"
        submitButtonLabel="Save"
        error={error}
      />

    </>
  );
}
