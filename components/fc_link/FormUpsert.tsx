'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertFcLink, removeFcLink } from '@/lib/fc_link/actions';
import type { FormUpsertProps } from '@/lib/fc_link/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError } from '@/components/ui';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialWorks = [], initialCharacters = [], initialMusics = [], initialChannels = [], searchWorkOptions, searchCharacterOptions, searchMusicOptions, searchChannelOptions, initialParentType, initialParentId }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const selectedParentTypeRef = useRef<HTMLInputElement>(null);
  const selectedParentIdRef = useRef<HTMLInputElement>(null);
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    name: nameRef.current?.value || '',
    url: urlRef.current?.value || '',
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
    formData.set('url', urlRef.current?.value || '');
    formData.set('selectedParentType', selectedParentTypeRef.current?.value || '');
    formData.set('selectedParentId', selectedParentIdRef.current?.value || '');

    try {
      startTransition(async () => {
        await upsertFcLink(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeFcLink([src.id]);
  };

  const handleBack = () => {
    router.push('/fc_link');
  };

  const formFields = (
    <>
      {/* bridge-parent: fc_linkable — set by parent-embedded create, not switchable */}
      {isEdit ? (
        <>
          <AppFieldText label={tf('parentType')} value={src.parent_type ?? ''} readOnly />
          <AppFieldText label={tf('parentLabel')} value={src.parent_label ?? ''} readOnly />
        </>
      ) : (
        <>
          <input type="hidden" ref={selectedParentTypeRef} defaultValue={initialParentType ?? ''} />
          <input type="hidden" ref={selectedParentIdRef} defaultValue={initialParentId ?? ''} />
        </>
      )}
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
        label={tf('url')}
        inputRef={urlRef}
        defaultValue={src.url || ''}
        required
        slotProps={{ htmlInput: { type: 'url' } }}
      />
      <AppValidationError message={validationError} />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('fcLink') }) : tc('addEntity', { entity: te('fcLink') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('fcLink')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
