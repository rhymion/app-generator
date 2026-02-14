'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { upsertBooking, removeBooking } from '@/lib/booking/actions';
import type { FormUpsertProps } from '@/lib/booking/types';
import FormWithChildGrid from '../FormWithChildGrid';
import AuditInfo from '../AuditInfo';

import dayjs, { Dayjs } from 'dayjs';
import DateTimeWrapper from '../DateTimeWrapper';

export default function FormUpsert({ src, isEdit, permissions, allResources = [], resourcePermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [startTime, setStartTime] = useState<Dayjs | null>(src.start_time ? dayjs(src.start_time) : null);
  const [endTime, setEndTime] = useState<Dayjs | null>(src.end_time ? dayjs(src.end_time) : null);
  const [resourceId, setResourceId] = useState<string | null>(src.resource_id || null);

  const nameRef = useRef<HTMLInputElement>(null);
  const resourceIdOptions = useMemo(() => {
    return allResources.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allResources]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('name', nameRef.current?.value || '');
    formData.set('resource_id', resourceId || '');
    formData.set('start_time', startTime?.toISOString() || '');
    formData.set('end_time', endTime?.toISOString() || '');

    try {
      startTransition(async () => {
        await upsertBooking(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeBooking(formData);
  };

  const handleBack = () => {
    router.push('/booking');
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
      <Autocomplete
        options={resourceIdOptions}
        value={resourceIdOptions.find((option) => option.id === resourceId) || null}
        onChange={(_, newValue) => setResourceId(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Resource"
            margin="normal"
            required
          />
        )}
      />
      <DateTimeWrapper 
        label="Start Time" 
        date_time={startTime ? startTime.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => setStartTime(newValue)}
      />
      <DateTimeWrapper 
        label="End Time" 
        date_time={endTime ? endTime.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => setEndTime(newValue)}
      />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Booking`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit && canDelete ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Booking"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
