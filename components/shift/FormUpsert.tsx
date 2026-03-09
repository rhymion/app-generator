'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { upsertShift, removeShift } from '@/lib/shift/actions';
import type { FormUpsertProps } from '@/lib/shift/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import dayjs, { Dayjs } from 'dayjs';
import DateTimeWrapper from '@/components/_standard/DateTimeWrapper';
import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, allUserAccounts = [], userAccountPermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [startTime, setStartTime] = useState<Dayjs | null>(src.start_time ? dayjs(src.start_time) : null);
  const [endTime, setEndTime] = useState<Dayjs | null>(src.end_time ? dayjs(src.end_time) : null);
  const [status, setStatus] = useState<number | null>(src.status ?? null);
  const [userAccountId, setUserAccountId] = useState<string | null>(src.user_account_id || null);
  const statusOptions = [{ value: 0, label: 'Scheduled' }, { value: 1, label: 'Approved' }, { value: 2, label: 'Cancelled' }];
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
    status: status,
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
    formData.set('status', status !== null ? String(status) : '');
    formData.set('start_time', startTime?.toISOString() || '');
    formData.set('end_time', endTime?.toISOString() || '');

    try {
      startTransition(async () => {
        await upsertShift(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeShift(formData);
  };

  const handleBack = () => {
    router.push('/shift');
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
            label={tf('userAccount')}
            margin="normal"
            required
          />
        )}
      />
      <Autocomplete
        options={statusOptions}
        value={statusOptions.find((o) => o.value === status) ?? null}
        onChange={(_, newValue) => setStatus(newValue?.value ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={tf('status')}
            margin="normal"
            required
          />
        )}
      />
      <DateTimeWrapper
        label={tf('startTime')} 
        date_time={startTime ? startTime.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => setStartTime(newValue)}
      />
      <DateTimeWrapper
        label={tf('endTime')} 
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
        title={isEdit ? tc('editEntity', { entity: te('shift') }) : tc('addEntity', { entity: te('shift') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('shift')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
