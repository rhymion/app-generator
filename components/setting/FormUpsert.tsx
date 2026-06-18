'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertSetting } from '@/lib/setting/actions';
import type { FormUpsertProps } from '@/lib/setting/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError } from '@/components/ui';
import type { Role } from '@/lib/role/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import ImageUpload from '@/components/_standard/ImageUpload';
import Password from './password';
import ApiKey from './api_key';
import MfaEnabled from './mfa_enabled';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialRoles = [], searchRoleOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [image, setImage] = useState<string>(src.image || '');
  const [password, setPassword] = useState<string>(src.password ?? '');
  const [apiKey, setApiKey] = useState<string>(src.api_key ?? '');
  const [mfaEnabled, setMfaEnabled] = useState<boolean>(Boolean(src.mfa_enabled));
  const rolesRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [localInitialRoles] = useState<EditableListWrapperItem[]>(() => src.roles.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.name ?? ''),
    originalId: f.id,
  })));
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    name: nameRef.current?.value || '',
    email: emailRef.current?.value || '',
    image: image,
    password: password,
    api_key: apiKey,
    mfa_enabled: mfaEnabled,
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
    formData.set('email', emailRef.current?.value || '');
    formData.set('image', image);
    formData.set('password', password);
    formData.set('api_key', apiKey);
    formData.set('mfa_enabled', mfaEnabled.toString());
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
        await upsertSetting(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleBack = () => {
    router.push('/setting');
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
        label={tf('email')}
        inputRef={emailRef}
        defaultValue={src.email || ''}
        required
        multiline={false}
        rows={undefined}
      />
      <ImageUpload
        value={image}
        onChange={setImage}
      />
      <Password value={password} onChange={setPassword} isEdit={isEdit} />
      <ApiKey value={apiKey} onChange={setApiKey} isEdit={isEdit} />
      <MfaEnabled value={mfaEnabled} onChange={setMfaEnabled} isEdit={isEdit} />
      <EditableListWrapper
        ref={rolesRef}
        initialItems={localInitialRoles}
        itemType="autocomplete"
        addButtonLabel="Add Roles"
        showTitle={true}
        title={tf('roles')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        searchOptions={async (query, includeIds) => {
          const rows = (await searchRoleOptions?.(query, includeIds)) ?? [];
          return rows.map(item => ({ id: item.id, label: (item.name ?? '') }));
        }}
        initialAutocompleteOptions={(initialRoles ?? []).map(item => ({
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
        title={isEdit ? tc('editEntity', { entity: te('setting') }) : tc('addEntity', { entity: te('setting') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={undefined}
        onBack={handleBack}
        deleteEntityLabel={te('setting')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
