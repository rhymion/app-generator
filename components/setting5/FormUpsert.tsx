'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import { upsertSetting5 } from '@/lib/setting5/actions';
import type { FormUpsertProps } from '@/lib/setting5/types';
import FormWithChildGrid from '../FormWithChildGrid';
import AuditInfo from '../AuditInfo';
import { GridRowsProp } from '@mui/x-data-grid';
  import FieldsDataGrid from '../FieldsDataGrid';
  import { yyyyy_yyyyys_columns } from '../setting5/column_def';
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
        await upsertSetting5(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleBack = () => {
    router.push('/setting5');
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
      <FieldsDataGrid
        ref={yyyyyYyyyysRef}
        initialFields={initialYyyyyYyyyys}
        columns={yyyyyYyyyysColumns}
        createNewRow={createNewYyyyyYyyyys}
        addButtonLabel="Add Yyyyy Yyyyys"
        deleteDialogTitle="Delete Selected Yyyyy Yyyyys?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="Yyyyy Yyyyys"
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('setting5') }) : tc('addEntity', { entity: te('setting5') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={undefined}
        onBack={handleBack}
        deleteEntityLabel={te('setting5')}
        submitButtonLabel={tc('save')}
        error={error}
      />

    </>
  );
}
