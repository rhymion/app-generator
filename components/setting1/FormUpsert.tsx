'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import { upsertSetting1, removeSetting1 } from '@/lib/setting1/actions';
import type { FormUpsertProps } from '@/lib/setting1/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { GridRowsProp } from '@mui/x-data-grid';
import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';
import { yyyyy_yyyyys_columns } from '../setting1/column_def';
import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);
  const yyyyyYyyyysRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const teamRef = useRef<HTMLInputElement>(null);
  const yyyyyYyyyysColumns = yyyyy_yyyyys_columns(true);

  const [initialYyyyyYyyyys] = useState<GridRowsProp>(() => src.yyyyy_yyyyys.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` })));

  const createNewYyyyyYyyyys = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    type: '',
    max_length: null,
    max: null,
    regex: '',
    required: true,
    written_by: '',
    xxxxx_xxxxx_id: src.id,
  });
  const validationError = useFormValidation({
    isEdit,
    id: src.id,
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
    formData.set('team', teamRef.current?.value || '');
    const yyyyyYyyyys = yyyyyYyyyysRef.current?.getFields?.() || [];

    (yyyyyYyyyys as GridRowsProp).forEach((field) => {
      formData.append(
        'yyyyy_yyyyy[]',
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

    try {
      startTransition(async () => {
        await upsertSetting1(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeSetting1([src.id]);
  };

  const handleBack = () => {
    router.push('/setting1');
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
      <TextField
        label={tf('team')}
        inputRef={teamRef}
        defaultValue={src.team || ''}
        fullWidth
        margin="normal"
        
        multiline={false}
        rows={undefined}
      />
      <FieldsDataGrid
        ref={yyyyyYyyyysRef}
        initialFields={initialYyyyyYyyyys}
        columns={yyyyyYyyyysColumns}
        createNewRow={createNewYyyyyYyyyys}
        addButtonLabel="Add Yyyyy Yyyyys"
        deleteDialogTitle="Delete Selected Yyyyy Yyyyys?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title={tf('yyyyyYyyyys')}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('setting1') }) : tc('addEntity', { entity: te('setting1') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('setting1')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
