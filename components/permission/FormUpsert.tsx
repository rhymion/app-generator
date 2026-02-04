'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { upsertPermission, removePermission } from '@/lib/permission/actions';
import type { FormUpsertProps } from '@/lib/permission/types';
import FormWithChildGrid from '../FormWithChildGrid';

import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

export default function FormUpsert({ src, isEdit, allRoles = [] }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
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
        options={roleIdOptions}
        value={roleIdOptions.find((option) => option.id === roleId) || null}
        onChange={(_, newValue) => setRoleId(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Role"
            margin="normal"
            
          />
        )}
      />
      <FormControlLabel
        control={<Checkbox checked={create} onChange={(e) => setCreate(e.target.checked)} />}
        label="Create"
      />
      <FormControlLabel
        control={<Checkbox checked={read} onChange={(e) => setRead(e.target.checked)} />}
        label="Read"
      />
      <FormControlLabel
        control={<Checkbox checked={update} onChange={(e) => setUpdate(e.target.checked)} />}
        label="Update"
      />
      <FormControlLabel
        control={<Checkbox checked={deleteValue} onChange={(e) => setDeleteValue(e.target.checked)} />}
        label="Delete"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Permission`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Permission"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
