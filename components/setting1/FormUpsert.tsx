'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertSetting1, removeSetting1 } from '@/lib/setting1/actions';
import type { FormUpsertProps } from '@/lib/setting1/types';
import FormWithChildGrid from '../FormWithChildGrid';
import AuditInfo from '../AuditInfo';

import ImageUpload from '../ImageUpload';

export default function FormUpsert({ src, isEdit, permissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [avatar, setAvatar] = useState<string>(src.avatar || '');

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const api_keyRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('name', nameRef.current?.value || '');
    formData.set('email', emailRef.current?.value || '');
    formData.set('password', passwordRef.current?.value || '');
    formData.set('api_key', api_keyRef.current?.value || '');
    formData.set('avatar', avatar);

    try {
      startTransition(async () => {
        await upsertSetting1(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeSetting1(formData);
  };

  const handleBack = () => {
    router.push('/setting1');
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
        label="Email"
        inputRef={emailRef}
        defaultValue={src.email || ''}
        fullWidth
        margin="normal"
        required
        multiline={false}
        rows={undefined}
      />
      <TextField
        label="Password"
        inputRef={passwordRef}
        defaultValue={src.password || ''}
        fullWidth
        margin="normal"
        required
        multiline={false}
        rows={undefined}
      />
      <TextField
        label="Api Key"
        inputRef={api_keyRef}
        defaultValue={src.api_key || ''}
        fullWidth
        margin="normal"
        
        multiline={false}
        rows={undefined}
      />
      <ImageUpload
        value={avatar}
        onChange={setAvatar}
      />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Setting1`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit && canDelete ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Setting1"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
