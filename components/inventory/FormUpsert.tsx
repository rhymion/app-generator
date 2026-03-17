'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import NumberField from '@/components/_standard/NumberField';
import { upsertInventory, removeInventory } from '@/lib/inventory/actions';
import type { FormUpsertProps } from '@/lib/inventory/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import dayjs, { Dayjs } from 'dayjs';
import DateTimeWrapper from '@/components/_standard/DateTimeWrapper';
import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, allProducts = [], productPermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [expirationDate, setExpirationDate] = useState<Dayjs | null>(src.expiration_date ? dayjs(src.expiration_date) : null);
  const [productId, setProductId] = useState<string | null>(src.product_id || null);
  const locationRef = useRef<HTMLInputElement>(null);
  const lot_numberRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const reserved_quantityRef = useRef<HTMLInputElement>(null);
  const productIdOptions = useMemo(() => {
    return allProducts.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allProducts]);
  const validationError = useFormValidation({
    isEdit,
    id: src.id,
    expiration_date: expirationDate,
    product_id: productId,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('location', locationRef.current?.value || '');
    formData.set('lot_number', lot_numberRef.current?.value || '');
    formData.set('product_id', productId || '');
    formData.set('quantity', quantityRef.current?.value || '');
    formData.set('reserved_quantity', reserved_quantityRef.current?.value || '');
    formData.set('expiration_date', expirationDate?.toISOString() || '');

    try {
      startTransition(async () => {
        await upsertInventory(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeInventory([src.id]);
  };

  const handleBack = () => {
    router.push('/inventory');
  };

  const formFields = (
    <>
      <TextField
        label={tf('location')}
        inputRef={locationRef}
        defaultValue={src.location || ''}
        fullWidth
        margin="normal"
        
        multiline={false}
        rows={undefined}
      />
      <TextField
        label={tf('lotNumber')}
        inputRef={lot_numberRef}
        defaultValue={src.lot_number || ''}
        fullWidth
        margin="normal"
        
        multiline={false}
        rows={undefined}
      />
      <Autocomplete
        options={productIdOptions}
        value={productIdOptions.find((option) => option.id === productId) || null}
        onChange={(_, newValue) => setProductId(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={tf('product')}
            margin="normal"
            required
          />
        )}
      />
      <NumberField
        label={tf('quantity')}
        inputRef={quantityRef}
        defaultValue={src.quantity || 0}
        min={0}
        max={1000000}
      />
      <NumberField
        label={tf('reservedQuantity')}
        inputRef={reserved_quantityRef}
        defaultValue={src.reserved_quantity || 0}
        min={0}
        max={1000000}
      />
      <DateTimeWrapper
        label={tf('expirationDate')} 
        show_time={false}
        date_time={expirationDate ? expirationDate.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => setExpirationDate(newValue)}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('inventory') }) : tc('addEntity', { entity: te('inventory') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('inventory')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
