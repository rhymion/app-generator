'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertUserAccount, removeUserAccount } from '@/lib/user_account/actions';
import type { FormUpsertProps } from '@/lib/user_account/types';
import FormWithChildGrid from '../FormWithChildGrid';
import EditableListWrapper, { EditableListWrapperItem } from '../EditableListWrapper';
import ImageUpload from '../ImageUpload';

export default function FormUpsert({ src, isEdit, allRoles = [] }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [avatar, setAvatar] = useState<string>(src.avatar || '');

  const roleRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const api_keyRef = useRef<HTMLInputElement>(null);
  const initialRole: EditableListWrapperItem[] = src.roles.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  }));
  const [selectedRoles, setSelectedRoles] = useState<EditableListWrapperItem[]>(initialRole);
  const autocompleteOptions = useMemo(() => {
    const assignedRoleIds = new Set(
      selectedRoles
        .map((role) => role.originalId ?? role.value)
        .filter((roleId): roleId is string => typeof roleId === 'string')
    );
    return allRoles
      .filter((role) => !assignedRoleIds.has(role.id))
      .map((role) => ({
        id: role.id,
        label: role.name,
        value: role.name,
      }));
  }, [allRoles, selectedRoles]);
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    formData.set('name', nameRef.current?.value || '');
    formData.set('email', emailRef.current?.value || '');
    formData.set('password', passwordRef.current?.value || '');
    formData.set('api_key', api_keyRef.current?.value || '');
    formData.set('avatar', avatar);
    const role = roleRef.current?.getItems?.() || [];

    role.forEach((item) => {
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
      <TextField
        label="Api Key"
        inputRef={api_keyRef}
        defaultValue={src.api_key || ''}
        fullWidth
        margin="normal"
        
        multiline={false}
        rows={undefined}
      />
      <ImageUpload
        value={avatar}
        onChange={setAvatar}
      />
      <EditableListWrapper
        ref={roleRef}
        initialItems={initialRole}
        itemType="autocomplete"
        addButtonLabel="Add Role"
        showTitle={true}
        title="Role"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        autocompleteOptions={autocompleteOptions}
        onItemsChange={setSelectedRoles}
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} User Account`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="User Account"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
