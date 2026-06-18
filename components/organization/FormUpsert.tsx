'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertOrganization, removeOrganization } from '@/lib/organization/actions';
import type { FormUpsertProps } from '@/lib/organization/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError } from '@/components/ui';
import type { User } from '@/lib/user/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialUsers = [], searchUserOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);
  const usersRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const [localInitialUsers] = useState<EditableListWrapperItem[]>(() => src.users.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.name ?? ''),
    originalId: f.id,
  })));
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    name: nameRef.current?.value || '',
    description: descriptionRef.current?.value || '',
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;
    const validationMessage = getValidationError();
    setValidationError(validationMessage);
    if (validationMessage) {
      return;
    }

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    const users = usersRef.current?.getItems?.() || [];

    users.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'user[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertOrganization(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeOrganization([src.id]);
  };

  const handleBack = () => {
    router.push('/organization');
  };

  const formFields = (
    <>
      <AppFieldText
        label={tf('name')}
        inputRef={nameRef}
        defaultValue={src.name || ''}
        required
        minLength={1}
        multiline={false}
        rows={undefined}
      />
      <AppFieldText
        label={tf('description')}
        inputRef={descriptionRef}
        defaultValue={src.description || ''}
        
        multiline={true}
        rows={4}
      />
      <EditableListWrapper
        ref={usersRef}
        initialItems={localInitialUsers}
        itemType="autocomplete"
        addButtonLabel="Add Users"
        showTitle={true}
        title={tf('users')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        searchOptions={async (query, includeIds) => {
          const rows = (await searchUserOptions?.(query, includeIds)) ?? [];
          return rows.map(item => ({ id: item.id, label: (item.name ?? '') }));
        }}
        initialAutocompleteOptions={(initialUsers ?? []).map(item => ({
          id: item.id,
          label: (item.name ?? ''),
        }))}
        excludeOptionIds={[src.id]}
      />
      <AppValidationError message={validationError} />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('organization') }) : tc('addEntity', { entity: te('organization') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('organization')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
