'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import { upsertProcedure, removeProcedure } from '@/lib/procedure/actions';
import type { FormUpsertProps } from '@/lib/procedure/types';
import FormWithChildGrid from '../FormWithChildGrid';
import type { Procedure } from '@/lib/procedure/types';
import EditableListWrapper, { EditableListWrapperItem } from '../EditableListWrapper';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '../FieldsDataGrid';
  

export default function FormUpsert({ src, isEdit, permissions, allProcedures = [], procedurePermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;

  const precededByRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const followedByRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const initialPrecededBy: EditableListWrapperItem[] = src.preceded_by.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  }));
  const [selectedPrecededBys, setSelectedPrecededBys] = useState<EditableListWrapperItem[]>(initialPrecededBy);
  const autocompleteOptionsPrecededBy = useMemo(() => {
    const assignedPrecededByIds = new Set(
      selectedPrecededBys
        .map((precededBy) => precededBy.originalId ?? precededBy.value)
        .filter((precededById): precededById is string => typeof precededById === 'string')
    );
    return allProcedures
      .filter((precededBy) => !assignedPrecededByIds.has(precededBy.id))
      .map((precededBy) => ({
        id: precededBy.id,
        label: precededBy.name,
        value: precededBy.name,
      }));
  }, [allProcedures, selectedPrecededBys]);
  const initialFollowedBy: EditableListWrapperItem[] = src.followed_by.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  }));
  const [selectedFollowedBys, setSelectedFollowedBys] = useState<EditableListWrapperItem[]>(initialFollowedBy);
  const autocompleteOptionsFollowedBy = useMemo(() => {
    const assignedFollowedByIds = new Set(
      selectedFollowedBys
        .map((followedBy) => followedBy.originalId ?? followedBy.value)
        .filter((followedById): followedById is string => typeof followedById === 'string')
    );
    return allProcedures
      .filter((followedBy) => !assignedFollowedByIds.has(followedBy.id))
      .map((followedBy) => ({
        id: followedBy.id,
        label: followedBy.name,
        value: followedBy.name,
      }));
  }, [allProcedures, selectedFollowedBys]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    const precededBy = precededByRef.current?.getItems?.() || [];

    precededBy.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'preceded_by[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });
    const followedBy = followedByRef.current?.getItems?.() || [];

    followedBy.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'followed_by[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertProcedure(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeProcedure(formData);
  };

  const handleBack = () => {
    router.push('/procedure');
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
        ref={precededByRef}
        initialItems={initialPrecededBy}
        itemType="autocomplete"
        addButtonLabel="Add Preceded By"
        showTitle={true}
        title="Preceded By"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        autocompleteOptions={autocompleteOptionsPrecededBy}
        onItemsChange={setSelectedPrecededBys}
      />
      <EditableListWrapper
        ref={followedByRef}
        initialItems={initialFollowedBy}
        itemType="autocomplete"
        addButtonLabel="Add Followed By"
        showTitle={true}
        title="Followed By"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        autocompleteOptions={autocompleteOptionsFollowedBy}
        onItemsChange={setSelectedFollowedBys}
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Procedure`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit && canDelete ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Procedure"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
