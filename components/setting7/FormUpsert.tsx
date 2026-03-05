'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertSetting7 } from '@/lib/setting7/actions';
import type { FormUpsertProps } from '@/lib/setting7/types';
import FormWithChildGrid from '../FormWithChildGrid';
import AuditInfo from '../AuditInfo';

import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);


  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const teamRef = useRef<HTMLInputElement>(null);
  const validationError = useFormValidation({
    isEdit,
    id: src.id,
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

    try {
      startTransition(async () => {
        await upsertSetting7(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleBack = () => {
    router.push('/setting7');
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
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={`${isEdit ? 'Edit' : 'Add'} Setting7`}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={undefined}
        onBack={handleBack}
        deleteEntityLabel="Setting7"
        submitButtonLabel="Save"
        error={error}
      />

    </>
  );
}
