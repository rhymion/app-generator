'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertScene, removeScene } from '@/lib/scene/actions';
import type { FormUpsertProps } from '@/lib/scene/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError, AppFieldRelation } from '@/components/ui';
import type { Character } from '@/lib/character/types';
import type { Music } from '@/lib/music/types';
import type { Creator } from '@/lib/creator/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import ChannelBridgeGrid from '../channel/ChannelBridgeGrid';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialCharacters = [], initialMusics = [], initialCreators = [], initialWorks = [], searchCharacterOptions, searchMusicOptions, searchCreatorOptions, searchWorkOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [workId, setWorkId] = useState<string | null>(src.work_id || null);
  const charactersRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const musicRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const creatorsRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const episodeRef = useRef<HTMLInputElement>(null);
  const timestampRef = useRef<HTMLInputElement>(null);
  const workIdInitialOptions = useMemo(() => (initialWorks ?? []).map((item) => ({
    id: item.id,
    label: (item.title ?? ''),
  })), [initialWorks]);
  const workIdSearchAction = useCallback(async (query: string, includeIds: string[]) => {
    const rows = (await searchWorkOptions?.(query, includeIds)) ?? [];
    return rows.map((item) => ({ id: item.id, label: (item.title ?? '') }));
  }, [searchWorkOptions]);
  const workIdCurrentOption = useMemo(() => (
    src.work ? { id: src.work.id, label: (src.work?.title ?? '') } : null
  ), [src.work]);
  const [localInitialCharacters] = useState<EditableListWrapperItem[]>(() => src.characters.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.name ?? ''),
    originalId: f.id,
  })));
  const [localInitialMusic] = useState<EditableListWrapperItem[]>(() => src.music.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.title ?? ''),
    originalId: f.id,
  })));
  const [localInitialCreators] = useState<EditableListWrapperItem[]>(() => src.creators.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.name ?? ''),
    originalId: f.id,
  })));
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    label: labelRef.current?.value || '',
    episode: episodeRef.current?.value || '',
    timestamp: timestampRef.current?.value || '',
    work_id: workId,
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
    formData.set('label', labelRef.current?.value || '');
    formData.set('episode', episodeRef.current?.value || '');
    formData.set('timestamp', timestampRef.current?.value || '');
    formData.set('work_id', workId || '');
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
    const music = musicRef.current?.getItems?.() || [];

    music.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'music[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });
    const creators = creatorsRef.current?.getItems?.() || [];

    creators.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'creator[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertScene(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeScene([src.id]);
  };

  const handleBack = () => {
    router.push('/scene');
  };

  const formFields = (
    <>
      <AppFieldText
        label={tf('label')}
        inputRef={labelRef}
        defaultValue={src.label || ''}
        required
        minLength={1}
        multiline={false}
        rows={undefined}
      />
      <AppFieldText
        label={tf('episode')}
        inputRef={episodeRef}
        defaultValue={src.episode || ''}
        required
        minLength={1}
        multiline={false}
        rows={undefined}
      />
      <AppFieldText
        label={tf('timestamp')}
        inputRef={timestampRef}
        defaultValue={src.timestamp || ''}
        required
        minLength={1}
        multiline={false}
        rows={undefined}
      />
      <AppFieldRelation
        label={tf('work')}
        value={workId}
        onChange={(id) => setWorkId(id)}
        searchAction={workIdSearchAction}
        initialOptions={workIdInitialOptions}
        currentOption={workIdCurrentOption}
        href={workId ? `/work/view/${workId}` : null}
        required={true}
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
        ref={musicRef}
        initialItems={localInitialMusic}
        itemType="autocomplete"
        addButtonLabel="Add Music"
        showTitle={true}
        title={tf('music')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        searchOptions={async (query, includeIds) => {
          const rows = (await searchMusicOptions?.(query, includeIds)) ?? [];
          return rows.map(item => ({ id: item.id, label: (item.title ?? '') }));
        }}
        initialAutocompleteOptions={(initialMusics ?? []).map(item => ({
          id: item.id,
          label: (item.title ?? ''),
        }))}
        excludeOptionIds={[src.id]}
      />
      <EditableListWrapper
        ref={creatorsRef}
        initialItems={localInitialCreators}
        itemType="autocomplete"
        addButtonLabel="Add Creators"
        showTitle={true}
        title={tf('creators')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        searchOptions={async (query, includeIds) => {
          const rows = (await searchCreatorOptions?.(query, includeIds)) ?? [];
          return rows.map(item => ({ id: item.id, label: (item.name ?? '') }));
        }}
        initialAutocompleteOptions={(initialCreators ?? []).map(item => ({
          id: item.id,
          label: (item.name ?? ''),
        }))}
        excludeOptionIds={[src.id]}
      />
      {isEdit && (
        <ChannelBridgeGrid
          bridgeId={String((src as Record<string, unknown>).channelable_id ?? '')}
          parentType="scene"
          parentId={src.id}
          title={te('channel')}
        />
      )}
      <AppValidationError message={validationError} />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('scene') }) : tc('addEntity', { entity: te('scene') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('scene')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
