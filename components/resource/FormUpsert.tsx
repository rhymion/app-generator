'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { upsertResource, removeResource } from '@/lib/resource/actions';
import type { FormUpsertProps } from '@/lib/resource/types';
import FormWithChildGrid from '../FormWithChildGrid';
import EditableListWrapper, { EditableListWrapperItem } from '../EditableListWrapper';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '../FieldsDataGrid';
  

export default function FormUpsert({ src, isEdit, permissions, allOrganizations = [], organizationPermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [organizationId, setOrganizationId] = useState<string | null>(src.organization_id || null);
  const resourceAttachmentsRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const resourceImagesRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const initialResourceAttachments: EditableListWrapperItem[] = src.resource_attachments.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.name,
    label: f.name,
    originalId: f.id,
  }));
  const initialResourceImages: EditableListWrapperItem[] = src.resource_images.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.name,
    label: f.name,
    originalId: f.id,
  }));
  const organizationIdOptions = useMemo(() => {
    return allOrganizations.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allOrganizations]);

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
    formData.set('organization_id', organizationId || '');
    const resourceAttachments = resourceAttachmentsRef.current?.getItems?.() || [];

    resourceAttachments.forEach((item) => {
      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);
      formData.append(
        'resource_attachment[]',
        JSON.stringify({
          id: itemId,
          name: item.value,
        })
      );
    });
    const resourceImages = resourceImagesRef.current?.getItems?.() || [];

    resourceImages.forEach((item) => {
      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);
      formData.append(
        'resource_image[]',
        JSON.stringify({
          id: itemId,
          name: item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertResource(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeResource(formData);
  };

  const handleBack = () => {
    router.push('/resource');
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
        options={organizationIdOptions}
        value={organizationIdOptions.find((option) => option.id === organizationId) || null}
        onChange={(_, newValue) => setOrganizationId(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Organization"
            margin="normal"
            required
          />
        )}
      />
      <EditableListWrapper
        ref={resourceAttachmentsRef}
        initialItems={initialResourceAttachments}
        itemType="text"
        addButtonLabel="Add Resource Attachments"
        showTitle={true}
        title="Resource Attachments"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
      />
      <EditableListWrapper
        ref={resourceImagesRef}
        initialItems={initialResourceImages}
        itemType="text"
        addButtonLabel="Add Resource Images"
        showTitle={true}
        title="Resource Images"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Resource`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit && canDelete ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Resource"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
