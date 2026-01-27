'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertParentOnly, removeParentOnly } from '@/lib/parent_only/actions';
import type { FormUpsertProps } from '@/lib/parent_only/types';
import FormWithChildGrid from '../FormWithChildGrid';


export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);


  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const login_timeRef = useRef<HTMLInputElement>(null);
  const logout_timeRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    formData.set('login_time', login_timeRef.current?.value || '');
    formData.set('logout_time', logout_timeRef.current?.value || '');

    try {
      startTransition(async () => {
        await upsertParentOnly(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeParentOnly(formData);
  };

  const handleBack = () => {
    router.push('/parent_only');
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
        label="Login Time"
        inputRef={login_timeRef}
        defaultValue={src.login_time || ''}
        fullWidth
        margin="normal"
        
        multiline={false}
        rows={undefined}
      />
      <TextField
        label="Logout Time"
        inputRef={logout_timeRef}
        defaultValue={src.logout_time || ''}
        fullWidth
        margin="normal"
        
        multiline={false}
        rows={undefined}
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Parent Only`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Parent Only"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
