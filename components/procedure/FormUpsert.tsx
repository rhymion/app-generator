'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { upsertProcedure, removeProcedure } from '@/lib/procedure/actions';
import type { FormUpsertProps } from '@/lib/procedure/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import type { Procedure } from '@/lib/procedure/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';
  
import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, allProcedures = [], allUserAccounts = [], procedurePermissions, userAccountPermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [parentId, setParentId] = useState<string | null>(src.parent_id || null);
  const [assigneeId, setAssigneeId] = useState<string | null>(src.assignee_id || null);
  const childrenRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const precededByRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const followedByRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const parentIdOptions = useMemo(() => {
    return allProcedures.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allProcedures]);
  const assigneeIdOptions = useMemo(() => {
    return allUserAccounts.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allUserAccounts]);
  const [initialChildren] = useState<EditableListWrapperItem[]>(() => src.children.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  })));
  const [initialPrecededBy] = useState<EditableListWrapperItem[]>(() => src.preceded_by.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  })));
  const [initialFollowedBy] = useState<EditableListWrapperItem[]>(() => src.followed_by.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  })));
  const validationError = useFormValidation({
    isEdit,
    id: src.id,
    parent_id: parentId,
    assignee_id: assigneeId,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    formData.set('parent_id', parentId || '');
    formData.set('assignee_id', assigneeId || '');
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
        label={tf('name')}
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
        label={tf('description')}
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
            label={tf('parent')}
            margin="normal"
            
          />
        )}
      />
      <Autocomplete
        options={assigneeIdOptions}
        value={assigneeIdOptions.find((option) => option.id === assigneeId) || null}
        onChange={(_, newValue) => setAssigneeId(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={tf('assignee')}
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
        title={tf('children')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        allAutocompleteOptions={allProcedures.filter(item => !item.parent_id || item.parent_id === src.id).map(item => ({
          id: item.id,
          label: item.name,
          value: item.id,
        }))}
        excludeOptionIds={[src.id]}
      />
      <EditableListWrapper
        ref={precededByRef}
        initialItems={initialPrecededBy}
        itemType="autocomplete"
        addButtonLabel="Add Preceded By"
        showTitle={true}
        title={tf('precededBy')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        allAutocompleteOptions={allProcedures.map(item => ({
          id: item.id,
          label: item.name,
          value: item.id,
        }))}
        excludeOptionIds={[src.id]}
      />
      <EditableListWrapper
        ref={followedByRef}
        initialItems={initialFollowedBy}
        itemType="autocomplete"
        addButtonLabel="Add Followed By"
        showTitle={true}
        title={tf('followedBy')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        allAutocompleteOptions={allProcedures.map(item => ({
          id: item.id,
          label: item.name,
          value: item.id,
        }))}
        excludeOptionIds={[src.id]}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('procedure') }) : tc('addEntity', { entity: te('procedure') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('procedure')}
        submitButtonLabel={tc('save')}
        error={error}
      />

    </>
  );
}
