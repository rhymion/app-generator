'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
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

  const [parentId, setParentId] = useState<string | null>(src.parent_id || null);
  const childrenRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const precededByRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const followedByRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const initialChildren: EditableListWrapperItem[] = src.children.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  }));
  const [selectedChildren, setSelectedChildren] = useState<EditableListWrapperItem[]>(initialChildren);
  const autocompleteOptionsChildren = useMemo(() => {
    const assignedChildrenIds = new Set(
      selectedChildren
        .map((children) => children.originalId ?? children.value)
        .filter((childrenId): childrenId is string => typeof childrenId === 'string')
    );
    return allProcedures
      .filter((children) => !assignedChildrenIds.has(children.id))
      .filter((children) => children.id !== src.id)
      .map((children) => ({
        id: children.id,
        label: children.name,
        value: children.id,
      }));
  }, [allProcedures, selectedChildren]);
  const initialPrecededBy: EditableListWrapperItem[] = src.preceded_by.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  }));
  const [selectedPrecededBy, setSelectedPrecededBy] = useState<EditableListWrapperItem[]>(initialPrecededBy);
  const autocompleteOptionsPrecededBy = useMemo(() => {
    const assignedPrecededByIds = new Set(
      selectedPrecededBy
        .map((precededBy) => precededBy.originalId ?? precededBy.value)
        .filter((precededById): precededById is string => typeof precededById === 'string')
    );
    return allProcedures
      .filter((precededBy) => !assignedPrecededByIds.has(precededBy.id))
      .filter((precededBy) => precededBy.id !== src.id)
      .map((precededBy) => ({
        id: precededBy.id,
        label: precededBy.name,
        value: precededBy.id,
      }));
  }, [allProcedures, selectedPrecededBy]);
  const initialFollowedBy: EditableListWrapperItem[] = src.followed_by.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  }));
  const [selectedFollowedBy, setSelectedFollowedBy] = useState<EditableListWrapperItem[]>(initialFollowedBy);
  const autocompleteOptionsFollowedBy = useMemo(() => {
    const assignedFollowedByIds = new Set(
      selectedFollowedBy
        .map((followedBy) => followedBy.originalId ?? followedBy.value)
        .filter((followedById): followedById is string => typeof followedById === 'string')
    );
    return allProcedures
      .filter((followedBy) => !assignedFollowedByIds.has(followedBy.id))
      .filter((followedBy) => followedBy.id !== src.id)
      .map((followedBy) => ({
        id: followedBy.id,
        label: followedBy.name,
        value: followedBy.id,
      }));
  }, [allProcedures, selectedFollowedBy]);
  const parentIdOptions = useMemo(() => {
    return allProcedures.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allProcedures]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    formData.set('parent_id', parentId || '');
    const children = childrenRef.current?.getItems?.() || [];

    children.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'children[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });
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
      <Autocomplete
        options={parentIdOptions}
        value={parentIdOptions.find((option) => option.id === parentId) || null}
        onChange={(_, newValue) => setParentId(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Parent"
            margin="normal"
            
          />
        )}
      />
      <EditableListWrapper
        ref={childrenRef}
        initialItems={initialChildren}
        itemType="autocomplete"
        addButtonLabel="Add Children"
        showTitle={true}
        title="Children"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        autocompleteOptions={autocompleteOptionsChildren}
        onItemsChange={setSelectedChildren}
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
        onItemsChange={setSelectedPrecededBy}
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
        onItemsChange={setSelectedFollowedBy}
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
