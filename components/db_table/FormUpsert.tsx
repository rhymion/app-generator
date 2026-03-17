'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import { upsertDbTable, removeDbTable, addDbTableComment, updateDbTableComment, deleteDbTableComment } from '@/lib/db_table/actions';
import type { FormUpsertProps } from '@/lib/db_table/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import CommentListWrapper from '@/components/_standard/CommentListWrapper';
import { GridRowsProp } from '@mui/x-data-grid';
import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';
import { fields_columns } from '../db_table/column_def';
import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, currentUserId }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);
  const fieldsRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const fieldsColumns = fields_columns(true);

  const [initialFields] = useState<GridRowsProp>(() => src.fields.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` })));

  const createNewFields = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    type: '',
    reference_id: '',
    max_length: null,
    max: null,
    regex: '',
    required: true,
    db_table_id: src.id,
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
    const fields = fieldsRef.current?.getFields?.() || [];

    (fields as GridRowsProp).forEach((field) => {
      formData.append(
        'field[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
          name: field.name,
          type: field.type,
          reference_id: field.reference_id,
          max_length: field.max_length,
          max: field.max,
          regex: field.regex,
          required: field.required,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertDbTable(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeDbTable([src.id]);
  };

  const handleBack = () => {
    router.push('/db_table');
  };

  const handleCreateComment = async (message: string) => {
    await addDbTableComment(src.id, message);
    router.refresh();
  };

  const handleUpdateComment = async (commentId: string, message: string) => {
    await updateDbTableComment(commentId, message);
    router.refresh();
  };

  const handleDeleteComment = async (commentId: string) => {
    await deleteDbTableComment(commentId);
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
      <FieldsDataGrid
        ref={fieldsRef}
        initialFields={initialFields}
        columns={fieldsColumns}
        createNewRow={createNewFields}
        addButtonLabel="Add Fields"
        deleteDialogTitle="Delete Selected Fields?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title={tf('fields')}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('dbTable') }) : tc('addEntity', { entity: te('dbTable') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('dbTable')}
        submitButtonLabel={tc('save')}
        error={error}
      />
      {isEdit && (
        <CommentListWrapper
          comments={src.db_table_comments}
          showTitle={true}
          title={tf('dbTableComments')}
          currentUserId={currentUserId}
          permissions={{ create: permissions?.update ?? false, delete: permissions?.update ?? false }}
          onCreateComment={handleCreateComment}
          onUpdateComment={handleUpdateComment}
          onDeleteComment={handleDeleteComment}
        />
      )}
    </>
  );
}
