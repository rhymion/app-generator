'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import NumberField from '@/components/_standard/NumberField';
import { upsertProduct, removeProduct } from '@/lib/product/actions';
import type { FormUpsertProps } from '@/lib/product/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
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
  const imagesRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const [initialImages] = useState<EditableListWrapperItem[]>(() => src.images.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.path,
    label: f.name,
    originalId: f.id,
  })));
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
    formData.set('code', codeRef.current?.value || '');
    formData.set('name', nameRef.current?.value || '');
    formData.set('price', priceRef.current?.value || '');
    const images = imagesRef.current?.getItems?.() || [];

    images.forEach((item) => {
      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);
      formData.append(
        'image[]',
        JSON.stringify({
          id: itemId,
          name: item.label,
          path: item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertProduct(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeProduct([src.id]);
  };

  const handleBack = () => {
    router.push('/product');
  };

  const formFields = (
    <>
      <TextField
        label={tf('code')}
        inputRef={codeRef}
        defaultValue={src.code || ''}
        fullWidth
        margin="normal"
        required
        slotProps={ { htmlInput: { minLength: 1 } } }
        multiline={false}
        rows={undefined}
      />
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
      <NumberField
        label={tf('price')}
        inputRef={priceRef}
        defaultValue={src.price || 0}
        min={0}
        max={1000000}
      />
      <EditableListWrapper
        ref={imagesRef}
        initialItems={initialImages}
        itemType="file"
        fileVariant="image"
        acceptedFileTypes="image/jpeg,image/png,image/gif,image/webp"
        addButtonLabel="Add Images"
        showTitle={true}
        title={tf('images')}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('product') }) : tc('addEntity', { entity: te('product') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('product')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
