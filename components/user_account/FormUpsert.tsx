'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertUserAccount, removeUserAccount } from '@/lib/user_account/actions';
import type { FormUpsertProps } from '@/lib/user_account/types';
import FormWithChildGrid from '../FormWithChildGrid';
import AuditInfo from '../AuditInfo';
import type { Role } from '@/lib/role/types';
import EditableListWrapper, { EditableListWrapperItem } from '../EditableListWrapper';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '../FieldsDataGrid';
  
import ImageUpload from '../ImageUpload';
import ApiKey from './api_key';

export default function FormUpsert({ src, isEdit, permissions, allRoles = [], rolePermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [avatar, setAvatar] = useState<string>(src.avatar || '');
  const [apiKey, setApiKey] = useState<string>(src.api_key ?? '');
  const rolesRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [initialRoles] = useState<EditableListWrapperItem[]>(() => src.roles.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  })));

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
    formData.set('avatar', avatar);
    formData.set('api_key', apiKey);
    const roles = rolesRef.current?.getItems?.() || [];

    roles.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'role[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertUserAccount(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeUserAccount(formData);
  };

  const handleBack = () => {
    router.push('/user_account');
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
      <ImageUpload
        value={avatar}
        onChange={setAvatar}
      />
      <ApiKey value={apiKey} onChange={setApiKey} isEdit={isEdit} />
      <EditableListWrapper
        ref={rolesRef}
        initialItems={initialRoles}
        itemType="autocomplete"
        addButtonLabel="Add Roles"
        showTitle={true}
        title="Roles"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        allAutocompleteOptions={allRoles.map(item => ({
          id: item.id,
          label: item.name,
          value: item.id,
        }))}
        excludeOptionIds={[src.id]}
      />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={`${isEdit ? 'Edit' : 'Add'} User Account`}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel="User Account"
        submitButtonLabel="Save"
        error={error}
      />

    </>
  );
}
