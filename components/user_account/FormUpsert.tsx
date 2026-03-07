'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import { upsertUserAccount, removeUserAccount } from '@/lib/user_account/actions';
import type { FormUpsertProps } from '@/lib/user_account/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import type { Role } from '@/lib/role/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';
  
import ImageUpload from '@/components/_standard/ImageUpload';
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

  const [avatar, setAvatar] = useState<string>(src.avatar || '');
  const rolesRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [initialRoles] = useState<EditableListWrapperItem[]>(() => src.roles.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  })));
  const validationError = useFormValidation({
    isEdit,
    id: src.id,
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
    formData.set('avatar', avatar);
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
      <ImageUpload
        value={avatar}
        onChange={setAvatar}
      />
      <EditableListWrapper
        ref={rolesRef}
        initialItems={initialRoles}
        itemType="autocomplete"
        addButtonLabel="Add Roles"
        showTitle={true}
        title={tf('roles')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        allAutocompleteOptions={allRoles.map(item => ({
          id: item.id,
          label: item.name,
          value: item.id,
        }))}
        excludeOptionIds={[src.id]}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('userAccount') }) : tc('addEntity', { entity: te('userAccount') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('userAccount')}
        submitButtonLabel={tc('save')}
        error={error}
      />

    </>
  );
}
