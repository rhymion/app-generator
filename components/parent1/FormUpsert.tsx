'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import NumberField from '../NumberField';
import { upsertParent1, removeParent1 } from '@/lib/parent1/actions';
import type { FormUpsertProps } from '@/lib/parent1/types';
import FormWithChildGrid from '../FormWithChildGrid';
import EditableListWrapper, { EditableListWrapperItem } from '../EditableListWrapper';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '../FieldsDataGrid';
import OrderedFieldsDataGrid from '../OrderedFieldsDataGrid';
  import { parent1_child1s_columns, parent1_child2s_columns } from '../parent1/column_def';
import dayjs, { Dayjs } from 'dayjs';
import DateTimeWrapper from '../DateTimeWrapper';
import ImageUpload from '../ImageUpload';

export default function FormUpsert({ src, isEdit, permissions, allOrganizations = [], organizationPermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [dueDate, setDueDate] = useState<Dayjs | null>(src.due_date ? dayjs(src.due_date) : null);
  const [imageUrl, setImageUrl] = useState<string>(src.image_url || '');
  const [organizationId, setOrganizationId] = useState<string | null>(src.organization_id || null);
  const parent1Child1sRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const parent1Child2sRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const parent1ListsRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const parent1Child1sColumns = parent1_child1s_columns(true);

  const initialParent1Child1s = src.parent1_child1s.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` }));

  const createNewParent1Child1s = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    order: 0,
    name: '',
    type: '',
    max_length: null,
    max: null,
    regex: '',
    required: true,
    written_by: '',
    parent1_id: src.id,
  });
  const parent1Child2sColumns = parent1_child2s_columns(true);

  const initialParent1Child2s = src.parent1_child2s.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` }));

  const createNewParent1Child2s = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    required: true,
    start_date: dayjs().toISOString(),
    end_date: dayjs().toISOString(),
    parent1_id: src.id,
  });
  const initialParent1Lists: EditableListWrapperItem[] = src.parent1_lists.map(f => ({
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
    formData.set('price', priceRef.current?.value || '');
    formData.set('due_date', dueDate?.toISOString() || '');
    formData.set('image_url', imageUrl);
    const parent1Child1s = parent1Child1sRef.current?.getFields?.() || [];

    (parent1Child1s as any[]).forEach((field) => {
      formData.append(
        'parent1_child1[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
          order: field.order,
          name: field.name,
          type: field.type,
          max_length: field.max_length,
          max: field.max,
          regex: field.regex,
          required: field.required,
          written_by: field.written_by,
        })
      );
    });
    const parent1Child2s = parent1Child2sRef.current?.getFields?.() || [];

    (parent1Child2s as any[]).forEach((field) => {
      formData.append(
        'parent1_child2[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
          name: field.name,
          required: field.required,
          start_date: field.start_date,
          end_date: field.end_date,
        })
      );
    });
    const parent1Lists = parent1ListsRef.current?.getItems?.() || [];

    parent1Lists.forEach((item) => {
      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);
      formData.append(
        'parent1_list[]',
        JSON.stringify({
          id: itemId,
          name: item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertParent1(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeParent1(formData);
  };

  const handleBack = () => {
    router.push('/parent1');
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
        slotProps={ { htmlInput: { minLength: 1, maxLength: 100 } } }
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
      <NumberField 
        label="Price" 
        inputRef={priceRef} 
        defaultValue={src.price || 0} 
        min={0}
        max={1000000}
      />
      <DateTimeWrapper 
        label="Due Date" 
        date_time={dueDate ? dueDate.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => setDueDate(newValue)}
      />
      <ImageUpload
        value={imageUrl}
        onChange={setImageUrl}
      />
      <OrderedFieldsDataGrid
        ref={parent1Child1sRef}
        initialFields={initialParent1Child1s}
        columns={parent1Child1sColumns}
        createNewRow={createNewParent1Child1s}
        addButtonLabel="Add Parent1 Child1s"
        deleteDialogTitle="Delete Selected Parent1 Child1s?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="Parent1 Child1s"
      />
      <FieldsDataGrid
        ref={parent1Child2sRef}
        initialFields={initialParent1Child2s}
        columns={parent1Child2sColumns}
        createNewRow={createNewParent1Child2s}
        addButtonLabel="Add Parent1 Child2s"
        deleteDialogTitle="Delete Selected Parent1 Child2s?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="Parent1 Child2s"
      />
      <EditableListWrapper
        ref={parent1ListsRef}
        initialItems={initialParent1Lists}
        itemType="text"
        addButtonLabel="Add Parent1 Lists"
        showTitle={true}
        title="Parent1 Lists"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Parent1`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit && canDelete ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Parent1"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
