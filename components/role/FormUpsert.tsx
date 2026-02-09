'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertRole, removeRole } from '@/lib/role/actions';
import type { FormUpsertProps } from '@/lib/role/types';
import FormWithChildGrid from '../FormWithChildGrid';
import type { UserAccount } from '@/lib/user_account/types';
import EditableListWrapper, { EditableListWrapperItem } from '../EditableListWrapper';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '../FieldsDataGrid';
  

export default function FormUpsert({ src, isEdit, permissions, allUserAccounts = [], userAccountPermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;

  const userAccountsRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const initialUserAccounts: EditableListWrapperItem[] = src.user_accounts.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  }));
  const [selectedUserAccounts, setSelectedUserAccounts] = useState<EditableListWrapperItem[]>(initialUserAccounts);
  const autocompleteOptionsUserAccounts = useMemo(() => {
    const assignedUserAccountsIds = new Set(
      selectedUserAccounts
        .map((userAccount) => userAccount.originalId ?? userAccount.value)
        .filter((userAccountId): userAccountId is string => typeof userAccountId === 'string')
    );
    return allUserAccounts
      .filter((userAccount) => !assignedUserAccountsIds.has(userAccount.id))
      .filter((userAccount) => userAccount.id !== src.id)
      .map((userAccount) => ({
        id: userAccount.id,
        label: userAccount.name,
        value: userAccount.id,
      }));
  }, [allUserAccounts, selectedUserAccounts]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    const userAccounts = userAccountsRef.current?.getItems?.() || [];

    userAccounts.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'user_account[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertRole(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeRole(formData);
  };

  const handleBack = () => {
    router.push('/role');
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
        label="Description"
        inputRef={descriptionRef}
        defaultValue={src.description || ''}
        fullWidth
        margin="normal"
        
        multiline={true}
        rows={4}
      />
      <EditableListWrapper
        ref={userAccountsRef}
        initialItems={initialUserAccounts}
        itemType="autocomplete"
        addButtonLabel="Add User Accounts"
        showTitle={true}
        title="User Accounts"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        autocompleteOptions={autocompleteOptionsUserAccounts}
        onItemsChange={setSelectedUserAccounts}
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Role`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit && canDelete ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Role"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
