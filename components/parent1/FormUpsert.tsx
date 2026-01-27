'use client';

import { SetStateAction, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';
import NumberField from '../NumberField';
import { upsertParent1, removeParent1 } from '@/lib/parent1/actions';
import type { FormUpsertProps } from '@/lib/parent1/types';
import FormWithChildGrid from '../FormWithChildGrid';
import { GridRowsProp } from '@mui/x-data-grid';
import FieldsDataGrid from '../FieldsDataGrid';
import { parent1_child1_columns, parent1_child2_columns } from '../parent1/column_def';
import dayjs, { Dayjs } from 'dayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import DateTimeWrapper from '../DateTimeWrapper';

export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<Dayjs | null>(src.due_date ? dayjs(src.due_date) : null);
  const [imageUrl, setImageUrl] = useState<string>(src.image_url || '');
  const [uploading, setUploading] = useState(false);
  

  const parent1_child1GridRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const parent1_child2GridRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const due_dateRef = useRef<HTMLInputElement>(null);
  const parent1_child1Columns = parent1_child1_columns(true);

  const initialParent1Child1 = src.parent1_child1s.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` }));

  const createNewParent1Child1 = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    type: 'string',
    max_length: null,
    max: null,
    regex: '',
    required: true,
    written_by: '',
    parent1_id: src.id,
  });
  const parent1_child2Columns = parent1_child2_columns(true);

  const initialParent1Child2 = src.parent1_child2s.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` }));

  const createNewParent1Child2 = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    required: true,
    start_date: '',
    end_date: '',
    parent1_id: src.id,
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const data = await response.json();
      setImageUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    formData.set('name', nameRef.current?.value || '');
    formData.set('description', descriptionRef.current?.value || '');
    formData.set('price', priceRef.current?.value || '');
    formData.set('due_date', dueDate?.toISOString() || '');
    formData.set('image_url', imageUrl);
    const parent1Child1 = parent1_child1GridRef.current?.getFields?.() || [];

    (parent1Child1 as any[]).forEach((field) => {
      formData.append(
        'parent1Child1[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
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
    const parent1Child2 = parent1_child2GridRef.current?.getFields?.() || [];

    (parent1Child2 as any[]).forEach((field) => {
      formData.append(
        'parent1Child2[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
          name: field.name,
          required: field.required,
          start_date: field.start_date,
          end_date: field.end_date,
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
        onChange={(newValue: SetStateAction<dayjs.Dayjs | null>) => setDueDate(newValue)}
      />
      <div style={{ margin: '16px 0' }}>
        <input
          accept="image/*"
          style={{ display: 'none' }}
          id="image-upload-button"
          type="file"
          onChange={handleFileUpload}
          disabled={uploading}
        />
        <label htmlFor="image-upload-button">
          <TextField
            label="Image URL"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            fullWidth
            margin="normal"
            helperText="You can paste a URL or upload a file"
            InputProps={{
              endAdornment: (
                <span style={{ marginLeft: '8px', whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    onClick={() => document.getElementById('image-upload-button')?.click()}
                    disabled={uploading}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: uploading ? '#ccc' : '#1976d2',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: uploading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {uploading ? 'Uploading...' : 'Upload'}
                  </button>
                </span>
              ),
            }}
          />
        </label>
        {imageUrl && (
          <div style={{ marginTop: '8px' }}>
            <img 
              src={imageUrl} 
              alt="Preview" 
              style={{ 
                maxWidth: '200px', 
                maxHeight: '200px', 
                objectFit: 'contain',
                border: '1px solid #ddd',
                borderRadius: '4px',
                padding: '4px'
              }} 
            />
          </div>
        )}
      </div>      <FieldsDataGrid
        ref={parent1_child1GridRef}
        initialFields={initialParent1Child1}
        columns={parent1_child1Columns}
        createNewRow={createNewParent1Child1}
        addButtonLabel="Add Parent1 Child1"
        deleteDialogTitle="Delete Selected Parent1 Child1?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="Parent1 Child1"
      />
      <FieldsDataGrid
        ref={parent1_child2GridRef}
        initialFields={initialParent1Child2}
        columns={parent1_child2Columns}
        createNewRow={createNewParent1Child2}
        addButtonLabel="Add Parent1 Child2"
        deleteDialogTitle="Delete Selected Parent1 Child2?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="Parent1 Child2"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={`${isEdit ? 'Edit' : 'Add'} Parent1`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="Parent1"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
