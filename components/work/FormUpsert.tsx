'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertWork, removeWork } from '@/lib/work/actions';
import type { FormUpsertProps } from '@/lib/work/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError, AppFieldSelect } from '@/components/ui';
import type { Character } from '@/lib/character/types';
import type { Scene } from '@/lib/scene/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import ChannelBridgeGrid from '../channel/ChannelBridgeGrid';
import FcLinkBridgeGrid from '../fc_link/FcLinkBridgeGrid';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialCharacters = [], initialScenes = [], searchCharacterOptions, searchSceneOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [pattern, setPattern] = useState<number | null>(src.pattern ?? null);
  const [status, setStatus] = useState<number | null>(src.status ?? null);
  const charactersRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const scenesRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const patternOptions = [{ value: 0, label: tf('pattern_A') }, { value: 1, label: tf('pattern_B') }];
  const statusOptions = [{ value: 0, label: tf('status_pending') }, { value: 1, label: tf('status_approved') }];
  const [localInitialCharacters] = useState<EditableListWrapperItem[]>(() => src.characters.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.name ?? ''),
    originalId: f.id,
  })));
  const [localInitialScenes] = useState<EditableListWrapperItem[]>(() => src.scenes.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.label ?? ''),
    originalId: f.id,
  })));
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    title: titleRef.current?.value || '',
    pattern: pattern,
    status: status,
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
    formData.set('title', titleRef.current?.value || '');
    formData.set('pattern', pattern !== null ? String(pattern) : '');
    formData.set('status', status !== null ? String(status) : '');
    const characters = charactersRef.current?.getItems?.() || [];

    characters.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'character[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });
    const scenes = scenesRef.current?.getItems?.() || [];

    scenes.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'scene[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertWork(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeWork([src.id]);
  };

  const handleBack = () => {
    router.push('/work');
  };

  const formFields = (
    <>
      <AppFieldText
        label={tf('title')}
        inputRef={titleRef}
        defaultValue={src.title || ''}
        required
        minLength={1}
        multiline={false}
        rows={undefined}
      />
      <AppFieldSelect
        options={patternOptions}
        value={patternOptions.find((o) => o.value === pattern) ?? null}
        onChange={(newValue) => setPattern(newValue)}
        label={tf('pattern')}
        required
      />
      <AppFieldSelect
        options={statusOptions}
        value={statusOptions.find((o) => o.value === status) ?? null}
        onChange={(newValue) => setStatus(newValue)}
        label={tf('status')}
        required
      />
      <EditableListWrapper
        ref={charactersRef}
        initialItems={localInitialCharacters}
        itemType="autocomplete"
        addButtonLabel="Add Characters"
        showTitle={true}
        title={tf('characters')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        searchOptions={async (query, includeIds) => {
          const rows = (await searchCharacterOptions?.(query, includeIds)) ?? [];
          return rows.map(item => ({ id: item.id, label: (item.name ?? '') }));
        }}
        initialAutocompleteOptions={(initialCharacters ?? []).map(item => ({
          id: item.id,
          label: (item.name ?? ''),
        }))}
        excludeOptionIds={[src.id]}
      />
      <EditableListWrapper
        ref={scenesRef}
        initialItems={localInitialScenes}
        itemType="autocomplete"
        addButtonLabel="Add Scenes"
        showTitle={true}
        title={tf('scenes')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        searchOptions={async (query, includeIds) => {
          const rows = (await searchSceneOptions?.(query, includeIds)) ?? [];
          return rows.map(item => ({ id: item.id, label: (item.label ?? '') }));
        }}
        initialAutocompleteOptions={(initialScenes ?? []).map(item => ({
          id: item.id,
          label: (item.label ?? ''),
        }))}
        excludeOptionIds={[src.id]}
      />
      {isEdit && (
        <ChannelBridgeGrid
          bridgeId={String((src as Record<string, unknown>).channelable_id ?? '')}
          parentType="work"
          parentId={src.id}
          title={te('channel')}
        />
      )}
      {isEdit && (
        <FcLinkBridgeGrid
          bridgeId={String((src as Record<string, unknown>).fc_linkable_id ?? '')}
          parentType="work"
          parentId={src.id}
          title={te('fcLink')}
        />
      )}
      <AppValidationError message={validationError} />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('work') }) : tc('addEntity', { entity: te('work') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('work')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
