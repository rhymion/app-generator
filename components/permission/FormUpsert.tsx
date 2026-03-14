'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { upsertPermission, removePermission } from '@/lib/permission/actions';
import type { FormUpsertProps } from '@/lib/permission/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, allRoles = [], rolePermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [create, setCreate] = useState<boolean>(Boolean(src.create));
  const [read, setRead] = useState<boolean>(Boolean(src.read));
  const [update, setUpdate] = useState<boolean>(Boolean(src.update));
  const [deleteValue, setDeleteValue] = useState<boolean>(Boolean(src.delete));
  const [roleId, setRoleId] = useState<string | null>(src.role_id || null);
  const nameRef = useRef<HTMLInputElement>(null);
  const roleIdOptions = useMemo(() => {
    return allRoles.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allRoles]);
  const validationError = useFormValidation({
    isEdit,
    id: src.id,
    role_id: roleId,
    create: create,
    read: read,
    update: update,
    delete: deleteValue,
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
    formData.set('role_id', roleId || '');
    formData.set('create', create.toString());
    formData.set('read', read.toString());
    formData.set('update', update.toString());
    formData.set('delete', deleteValue.toString());

    try {
      startTransition(async () => {
        await upsertPermission(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removePermission(formData);
  };

  const handleBack = () => {
    router.push('/permission');
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
      <Autocomplete
        options={roleIdOptions}
        value={roleIdOptions.find((option) => option.id === roleId) || null}
        onChange={(_, newValue) => setRoleId(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={tf('role')}
            margin="normal"
            
          />
        )}
      />
      <FormControlLabel
        control={<Checkbox checked={create} onChange={(e) => setCreate(e.target.checked)} />}
        label={tf('create')}
      />
      <FormControlLabel
        control={<Checkbox checked={read} onChange={(e) => setRead(e.target.checked)} />}
        label={tf('read')}
      />
      <FormControlLabel
        control={<Checkbox checked={update} onChange={(e) => setUpdate(e.target.checked)} />}
        label={tf('update')}
      />
      <FormControlLabel
        control={<Checkbox checked={deleteValue} onChange={(e) => setDeleteValue(e.target.checked)} />}
        label={tf('delete')}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('permission') }) : tc('addEntity', { entity: te('permission') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('permission')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
