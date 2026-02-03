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
import type { Role } from '@/lib/role/types';


export default function FormUpsert({ src, isEdit, allRoles = [] }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [roleId, setRoleId] = useState<string | null>(src.role_id || null);


  const nameRef = useRef<HTMLInputElement>(null);
  const [canCreate, setCanCreate] = useState<boolean>(Boolean(src.create));
  const [canRead, setCanRead] = useState<boolean>(Boolean(src.read));
  const [canUpdate, setCanUpdate] = useState<boolean>(Boolean(src.update));
  const [canRemove, setCanRemove] = useState<boolean>(Boolean(src.remove));
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
    formData.set('create', canCreate.toString());
    formData.set('read', canRead.toString());
    formData.set('update', canUpdate.toString());
    formData.set('remove', canRemove.toString());
    formData.set('role_id', roleId || '');

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
      <FormControlLabel 
        control={<Checkbox checked={canCreate} onChange={(e) => setCanCreate(e.target.checked)} />} 
        label="Create" 
      />
      <FormControlLabel 
        control={<Checkbox checked={canRead} onChange={(e) => setCanRead(e.target.checked)} />} 
        label="Read" 
      />
      <FormControlLabel 
        control={<Checkbox checked={canUpdate} onChange={(e) => setCanUpdate(e.target.checked)} />} 
        label="Update" 
      />
      <FormControlLabel 
        control={<Checkbox checked={canRemove} onChange={(e) => setCanRemove(e.target.checked)} />} 
        label="Remove" 
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
