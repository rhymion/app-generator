'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertMusic, removeMusic } from '@/lib/music/actions';
import type { FormUpsertProps } from '@/lib/music/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError, AppFieldSelect } from '@/components/ui';
import type { Scene } from '@/lib/scene/types';
import type { Creator } from '@/lib/creator/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import FcLinkBridgeGrid from '../fc_link/FcLinkBridgeGrid';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialScenes = [], initialCreators = [], searchSceneOptions, searchCreatorOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [kind, setKind] = useState<number | null>(src.kind ?? null);
  const scenesRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const composersRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const creditsRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const kindOptions = [{ value: 0, label: tf('kind_op') }, { value: 1, label: tf('kind_cd') }, { value: 2, label: tf('kind_bgm') }, { value: 3, label: tf('kind_insert') }];
  const [localInitialScenes] = useState<EditableListWrapperItem[]>(() => src.scenes.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.label ?? ''),
    originalId: f.id,
  })));
  const [localInitialComposers] = useState<EditableListWrapperItem[]>(() => src.composers.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.name ?? ''),
    originalId: f.id,
  })));
  const [localInitialCredits] = useState<EditableListWrapperItem[]>(() => src.credits.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.name ?? ''),
    originalId: f.id,
  })));
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    title: titleRef.current?.value || '',
    kind: kind,
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
    formData.set('kind', kind !== null ? String(kind) : '');
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
    const composers = composersRef.current?.getItems?.() || [];

    composers.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'composer[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });
    const credits = creditsRef.current?.getItems?.() || [];

    credits.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'credit[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertMusic(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeMusic([src.id]);
  };

  const handleBack = () => {
    router.push('/music');
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
        options={kindOptions}
        value={kindOptions.find((o) => o.value === kind) ?? null}
        onChange={(newValue) => setKind(newValue)}
        label={tf('kind')}
        required
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
        ref={composersRef}
        initialItems={localInitialComposers}
        itemType="autocomplete"
        addButtonLabel="Add Composers"
        showTitle={true}
        title={tf('composers')}
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
      <EditableListWrapper
        ref={creditsRef}
        initialItems={localInitialCredits}
        itemType="autocomplete"
        addButtonLabel="Add Credits"
        showTitle={true}
        title={tf('credits')}
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
        <FcLinkBridgeGrid
          bridgeId={String((src as Record<string, unknown>).fc_linkable_id ?? '')}
          parentType="music"
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
        title={isEdit ? tc('editEntity', { entity: te('music') }) : tc('addEntity', { entity: te('music') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('music')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
