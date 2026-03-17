'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { upsertPurchaseOrder, removePurchaseOrder } from '@/lib/purchase_order/actions';
import type { FormUpsertProps } from '@/lib/purchase_order/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { GridRowsProp } from '@mui/x-data-grid';
import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';
import { items_columns } from '../purchase_order/column_def';
import { useFormValidation } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, allUserAccounts = [], allProducts = [], userAccountPermissions, productPermissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [customerId, setCustomerId] = useState<string | null>(src.customer_id || null);
  const itemsRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const order_noRef = useRef<HTMLInputElement>(null);
  const customerIdOptions = useMemo(() => {
    return allUserAccounts.map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }, [allUserAccounts]);
  const productIdOptions = useMemo(() =>
    (allProducts ?? []).map(item => ({ value: item.id, label: item.name })),
  [allProducts]);
  const itemsColumns = items_columns(true, productIdOptions);

  const [initialItems] = useState<GridRowsProp>(() => src.items.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` })));

  const createNewItems = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    product_id: '',
    quantity: 0,
    price: null,
    purchase_order_id: src.id,
  });
  const validationError = useFormValidation({
    isEdit,
    id: src.id,
    customer_id: customerId,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('order_no', order_noRef.current?.value || '');
    formData.set('customer_id', customerId || '');
    const items = itemsRef.current?.getFields?.() || [];

    (items as GridRowsProp).forEach((field) => {
      formData.append(
        'item[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
          product_id: field.product_id,
          quantity: field.quantity,
          price: field.price,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertPurchaseOrder(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removePurchaseOrder([src.id]);
  };

  const handleBack = () => {
    router.push('/purchase_order');
  };

  const formFields = (
    <>
      <TextField
        label={tf('orderNo')}
        inputRef={order_noRef}
        defaultValue={src.order_no || ''}
        fullWidth
        margin="normal"
        required
        slotProps={ { htmlInput: { minLength: 1 } } }
        multiline={false}
        rows={undefined}
      />
      <Autocomplete
        options={customerIdOptions}
        value={customerIdOptions.find((option) => option.id === customerId) || null}
        onChange={(_, newValue) => setCustomerId(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={tf('customer')}
            margin="normal"
            required
          />
        )}
      />
      <FieldsDataGrid
        ref={itemsRef}
        initialFields={initialItems}
        columns={itemsColumns}
        createNewRow={createNewItems}
        addButtonLabel="Add Items"
        deleteDialogTitle="Delete Selected Items?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title={tf('items')}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('purchaseOrder') }) : tc('addEntity', { entity: te('purchaseOrder') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('purchaseOrder')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
