'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import { upsertParentOnly, removeParentOnly } from '@/lib/parent_only/actions';
import type { FormUpsertProps } from '@/lib/parent_only/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import dayjs, { Dayjs } from 'dayjs';
import DateTimeWrapper from '@/components/_standard/DateTimeWrapper';
import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [loginTime, setLoginTime] = useState<Dayjs | null>(src.login_time ? dayjs(src.login_time) : null);
  const [logoutTime, setLogoutTime] = useState<Dayjs | null>(src.logout_time ? dayjs(src.logout_time) : null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const validationError = useFormValidation({
    isEdit,
    id: src.id,
    login_time: loginTime,
    logout_time: logoutTime,
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
        label={tf('name')}
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
        label={tf('description')}
        inputRef={descriptionRef}
        defaultValue={src.description || ''}
        fullWidth
        margin="normal"
        
        multiline={true}
        rows={4}
      />
      <DateTimeWrapper
        label={tf('loginTime')} 
        date_time={loginTime ? loginTime.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => setLoginTime(newValue)}
      />
      <DateTimeWrapper
        label={tf('logoutTime')} 
        date_time={logoutTime ? logoutTime.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => setLogoutTime(newValue)}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('parentOnly') }) : tc('addEntity', { entity: te('parentOnly') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('parentOnly')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
