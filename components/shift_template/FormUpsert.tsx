'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { upsertShiftTemplate, removeShiftTemplate } from '@/lib/shift_template/actions';
import type { FormUpsertProps } from '@/lib/shift_template/types';
import FormWithChildGrid from '../FormWithChildGrid';
import AuditInfo from '../AuditInfo';

import dayjs, { Dayjs } from 'dayjs';
import DateTimeWrapper from '../DateTimeWrapper';
import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, allUserAccounts = [], userAccountPermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [startTime, setStartTime] = useState<Dayjs | null>(src.start_time ? dayjs(src.start_time) : null);
  const [endTime, setEndTime] = useState<Dayjs | null>(src.end_time ? dayjs(src.end_time) : null);
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(src.day_of_week ?? null);
  const [userAccountId, setUserAccountId] = useState<string | null>(src.user_account_id || null);


  const dayOfWeekOptions = [{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }];
  const userAccountIdOptions = useMemo(() => {
    return allUserAccounts.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allUserAccounts]);
  const validationError = useFormValidation({
    isEdit,
    id: src.id,
    start_time: startTime,
    end_time: endTime,
    user_account_id: userAccountId,
    day_of_week: dayOfWeek,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('user_account_id', userAccountId || '');
    formData.set('day_of_week', dayOfWeek !== null ? String(dayOfWeek) : '');
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
      <Autocomplete
        options={dayOfWeekOptions}
        value={dayOfWeekOptions.find((o) => o.value === dayOfWeek) ?? null}
        onChange={(_, newValue) => setDayOfWeek(newValue?.value ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Day Of Week"
            margin="normal"
            required
          />
        )}
      />
      <DateTimeWrapper 
        label="Start Time" 
        show_date={false}
        date_time={startTime ? startTime.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => setStartTime(newValue)}
      />
      <DateTimeWrapper 
        label="End Time" 
        show_date={false}
        date_time={endTime ? endTime.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => setEndTime(newValue)}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
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
