'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertCreator, removeCreator } from '@/lib/creator/actions';
import type { FormUpsertProps } from '@/lib/creator/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError, AppFieldSelect } from '@/components/ui';
import type { Character } from '@/lib/character/types';
import type { Music } from '@/lib/music/types';
import type { Scene } from '@/lib/scene/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialCharacters = [], initialMusics = [], initialScenes = [], searchCharacterOptions, searchMusicOptions, searchSceneOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [role, setRole] = useState<number | null>(src.role ?? null);
  const [affiliation, setAffiliation] = useState<number | null>(src.affiliation ?? null);
  const voicedCharactersRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const composedMusicsRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const creditedMusicsRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const creditedScenesRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const roleOptions = [{ value: 0, label: tf('role_voice') }, { value: 1, label: tf('role_anim') }, { value: 2, label: tf('role_bgm') }, { value: 3, label: tf('role_etc') }];
  const affiliationOptions = [{ value: 0, label: tf('affiliation_agency') }, { value: 1, label: tf('affiliation_freelance') }, { value: 2, label: tf('affiliation_student') }];
  const [localInitialVoicedCharacters] = useState<EditableListWrapperItem[]>(() => src.voiced_characters.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.name ?? ''),
    originalId: f.id,
  })));
  const [localInitialComposedMusics] = useState<EditableListWrapperItem[]>(() => src.composed_musics.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.title ?? ''),
    originalId: f.id,
  })));
  const [localInitialCreditedMusics] = useState<EditableListWrapperItem[]>(() => src.credited_musics.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.title ?? ''),
    originalId: f.id,
  })));
  const [localInitialCreditedScenes] = useState<EditableListWrapperItem[]>(() => src.credited_scenes.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.label ?? ''),
    originalId: f.id,
  })));
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    name: nameRef.current?.value || '',
    role: role,
    affiliation: affiliation,
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
    formData.set('role', role !== null ? String(role) : '');
    formData.set('affiliation', affiliation !== null ? String(affiliation) : '');
    const voicedCharacters = voicedCharactersRef.current?.getItems?.() || [];

    voicedCharacters.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'voiced_character[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });
    const composedMusics = composedMusicsRef.current?.getItems?.() || [];

    composedMusics.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'composed_music[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });
    const creditedMusics = creditedMusicsRef.current?.getItems?.() || [];

    creditedMusics.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'credited_music[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });
    const creditedScenes = creditedScenesRef.current?.getItems?.() || [];

    creditedScenes.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'credited_scene[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertCreator(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeCreator([src.id]);
  };

  const handleBack = () => {
    router.push('/creator');
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
      <AppFieldSelect
        options={roleOptions}
        value={roleOptions.find((o) => o.value === role) ?? null}
        onChange={(newValue) => setRole(newValue)}
        label={tf('role')}
        required
      />
      <AppFieldSelect
        options={affiliationOptions}
        value={affiliationOptions.find((o) => o.value === affiliation) ?? null}
        onChange={(newValue) => setAffiliation(newValue)}
        label={tf('affiliation')}
        required
      />
      <EditableListWrapper
        ref={voicedCharactersRef}
        initialItems={localInitialVoicedCharacters}
        itemType="autocomplete"
        addButtonLabel="Add Voiced Characters"
        showTitle={true}
        title={tf('voicedCharacters')}
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
        ref={composedMusicsRef}
        initialItems={localInitialComposedMusics}
        itemType="autocomplete"
        addButtonLabel="Add Composed Musics"
        showTitle={true}
        title={tf('composedMusics')}
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
        ref={creditedMusicsRef}
        initialItems={localInitialCreditedMusics}
        itemType="autocomplete"
        addButtonLabel="Add Credited Musics"
        showTitle={true}
        title={tf('creditedMusics')}
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
        ref={creditedScenesRef}
        initialItems={localInitialCreditedScenes}
        itemType="autocomplete"
        addButtonLabel="Add Credited Scenes"
        showTitle={true}
        title={tf('creditedScenes')}
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
      <AppValidationError message={validationError} />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('creator') }) : tc('addEntity', { entity: te('creator') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('creator')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
