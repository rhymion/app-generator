'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import NumberField from '../NumberField';
import { upsertShiftTemplate, removeShiftTemplate } from '@/lib/shift_template/actions';
import type { FormUpsertProps } from '@/lib/shift_template/types';
import FormWithChildGrid from '../FormWithChildGrid';
import AuditInfo from '../AuditInfo';

import dayjs, { Dayjs } from 'dayjs';
import DateTimeWrapper from '../DateTimeWrapper';

export default function FormUpsert({ src, isEdit, permissions, allUserAccounts = [], userAccountPermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [startTime, setStartTime] = useState<Dayjs | null>(src.start_time ? dayjs(src.start_time) : null);
  const [endTime, setEndTime] = useState<Dayjs | null>(src.end_time ? dayjs(src.end_time) : null);
  const [userAccountId, setUserAccountId] = useState<string | null>(src.user_account_id || null);

  const day_of_weekRef = useRef<HTMLInputElement>(null);
  const userAccountIdOptions = useMemo(() => {
    return allUserAccounts.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allUserAccounts]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('user_account_id', userAccountId || '');
    formData.set('day_of_week', day_of_weekRef.current?.value || '');
    formData.set('start_time', startTime?.toISOString() || '');
    formData.set('end_time', endTime?.toISOString() || '');

    try {
      startTransition(async () => {
        await upsertShiftTemplate(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeShiftTemplate(formData);
  };

  const handleBack = () => {
    router.push('/shift_template');
    router.refresh();
  };

  const formFields = (
    <>
      <Autocomplete
        options={userAccountIdOptions}
        value={userAccountIdOptions.find((option) => option.id === userAccountId) || null}
        onChange={(_, newValue) => setUserAccountId(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="User Account"
            margin="normal"
            required
          />
        )}
      />
      <NumberField 
        label="Day Of Week" 
        inputRef={day_of_weekRef} 
        defaultValue={src.day_of_week || 0} 
        min={0}
        max={6}
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
    <>
      <FormWithChildGrid
        title={`${isEdit ? 'Edit' : 'Add'} Shift Template`}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel="Shift Template"
        submitButtonLabel="Save"
        error={error}
      />

    </>
  );
}
