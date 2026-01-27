'use client';

import { SetStateAction, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertParentOnly, removeParentOnly } from '@/lib/parent_only/actions';
import type { FormUpsertProps } from '@/lib/parent_only/types';
import FormWithChildGrid from '../FormWithChildGrid';
import dayjs, { Dayjs } from 'dayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import DateTimeWrapper from '../DateTimeWrapper';

export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);


  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const [loginTime, setLoginTime] = useState<Dayjs | null>(src.login_time ? dayjs(src.login_time) : null);
  const [logoutTime, setLogoutTime] = useState<Dayjs | null>(src.logout_time ? dayjs(src.logout_time) : null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    formData.set('login_time', loginTime?.toISOString() || '');
    formData.set('logout_time', logoutTime?.toISOString() || '');

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
      <DateTimeWrapper 
        label="Login Time" 
        date_time={loginTime ? loginTime.toDate() : null}
        onChange={(newValue: SetStateAction<dayjs.Dayjs | null>) => setLoginTime(newValue)}
      />
      <DateTimeWrapper 
        label="Logout Time" 
        date_time={logoutTime ? logoutTime.toDate() : null} 
        onChange={(newValue: SetStateAction<dayjs.Dayjs | null>) => setLogoutTime(newValue)}
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
