'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertRole, removeRole } from '@/lib/role/actions';
import type { FormUpsertProps } from '@/lib/role/types';
import FormWithChildGrid from '../FormWithChildGrid';
import EditableListWrapper, { EditableListWrapperItem } from '../EditableListWrapper';
import { GridRowsProp } from '@mui/x-data-grid';
import FieldsDataGrid from '../FieldsDataGrid';
import { user_account_columns } from '../role/column_def';

export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);


  const user_accountRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const initialUserAccount: EditableListWrapperItem[] = src.user_accounts.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.name,
    label: f.name,
    originalId: f.id,
  }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    const userAccount = user_accountRef.current?.getItems?.() || [];

    userAccount.forEach((item) => {
      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);
      formData.append(
        'userAccount[]',
        JSON.stringify({
          id: itemId,
          name: item.value,
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
        ref={user_accountRef}
        initialItems={initialUserAccount}
        itemType="text"
        addButtonLabel="Add User Account"
        showTitle={true}
        title="User Account"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Role`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Role"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
