'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertCharacter, removeCharacter } from '@/lib/character/actions';
import type { FormUpsertProps } from '@/lib/character/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError, AppFieldRelation } from '@/components/ui';
import type { Scene } from '@/lib/scene/types';
import type { Creator } from '@/lib/creator/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import ChannelBridgeGrid from '../channel/ChannelBridgeGrid';
import FcLinkBridgeGrid from '../fc_link/FcLinkBridgeGrid';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialScenes = [], initialCreators = [], initialWorks = [], searchSceneOptions, searchCreatorOptions, searchWorkOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [officialImage, setOfficialImage] = useState<boolean>(Boolean(src.official_image));
  const [workId, setWorkId] = useState<string | null>(src.work_id || null);
  const scenesRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const creatorsRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
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
  const [localInitialScenes] = useState<EditableListWrapperItem[]>(() => src.scenes.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.label ?? ''),
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
    name: nameRef.current?.value || '',
    work_id: workId,
    official_image: officialImage,
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
    formData.set('work_id', workId || '');
    formData.set('official_image', officialImage.toString());
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
        await upsertCharacter(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeCharacter([src.id]);
  };

  const handleBack = () => {
    router.push('/character');
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
      <AppFieldBoolean
        label={tf('officialImage')}
        checked={officialImage}
        onChange={(e) => setOfficialImage(e.target.checked)}
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
          parentType="character"
          parentId={src.id}
          title={te('channel')}
        />
      )}
      {isEdit && (
        <FcLinkBridgeGrid
          bridgeId={String((src as Record<string, unknown>).fc_linkable_id ?? '')}
          parentType="character"
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
        title={isEdit ? tc('editEntity', { entity: te('character') }) : tc('addEntity', { entity: te('character') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('character')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
