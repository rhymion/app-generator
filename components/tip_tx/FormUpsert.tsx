'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import NumberField from '@/components/_standard/NumberField';
import { upsertTipTx, removeTipTx } from '@/lib/tip_tx/actions';
import type { FormUpsertProps } from '@/lib/tip_tx/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError, AppFieldRelation, AppFieldSelect } from '@/components/ui';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialComments = [], searchCommentOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [status, setStatus] = useState<number | null>(src.status ?? null);
  const [commentId, setCommentId] = useState<string | null>(src.comment_id || null);
  const contract_split_idRef = useRef<HTMLInputElement>(null);
  const gross_amountRef = useRef<HTMLInputElement>(null);
  const operator_feeRef = useRef<HTMLInputElement>(null);
  const payment_feeRef = useRef<HTMLInputElement>(null);
  const statusOptions = [{ value: 0, label: tf('status_pending') }, { value: 1, label: tf('status_held') }, { value: 2, label: tf('status_paid') }];
  const commentIdInitialOptions = useMemo(() => (initialComments ?? []).map((item) => ({
    id: item.id,
    label: (item.message ?? ''),
  })), [initialComments]);
  const commentIdSearchAction = useCallback(async (query: string, includeIds: string[]) => {
    const rows = (await searchCommentOptions?.(query, includeIds)) ?? [];
    return rows.map((item) => ({ id: item.id, label: (item.message ?? '') }));
  }, [searchCommentOptions]);
  const commentIdCurrentOption = useMemo(() => (
    src.comment ? { id: src.comment.id, label: (src.comment?.message ?? '') } : null
  ), [src.comment]);
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    contract_split_id: contract_split_idRef.current?.value || '',
    gross_amount: gross_amountRef.current?.value || '',
    operator_fee: operator_feeRef.current?.value || '',
    payment_fee: payment_feeRef.current?.value || '',
    comment_id: commentId,
    status: status,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;
    const validationMessage = getValidationError();
    setValidationError(validationMessage);
    if (validationMessage) {
      return;
    }

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('contract_split_id', contract_split_idRef.current?.value || '');
    formData.set('comment_id', commentId || '');
    formData.set('gross_amount', gross_amountRef.current?.value || '');
    formData.set('operator_fee', operator_feeRef.current?.value || '');
    formData.set('payment_fee', payment_feeRef.current?.value || '');
    formData.set('status', status !== null ? String(status) : '');

    try {
      startTransition(async () => {
        await upsertTipTx(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeTipTx([src.id]);
  };

  const handleBack = () => {
    router.push('/tip_tx');
  };

  const formFields = (
    <>
      <AppFieldText
        label={tf('contractSplitId')}
        inputRef={contract_split_idRef}
        defaultValue={src.contract_split_id || ''}
        required
        minLength={1}
        multiline={false}
        rows={undefined}
      />
      <AppFieldRelation
        label={tf('comment')}
        value={commentId}
        onChange={(id) => setCommentId(id)}
        searchAction={commentIdSearchAction}
        initialOptions={commentIdInitialOptions}
        currentOption={commentIdCurrentOption}
        href={commentId ? `/comment/view/${commentId}` : null}
        required={true}
      />
      <NumberField
        label={tf('grossAmount')}
        inputRef={gross_amountRef}
        defaultValue={src.gross_amount || undefined}
        required
        min={0}
        max={2147483647}
      />
      <NumberField
        label={tf('operatorFee')}
        inputRef={operator_feeRef}
        defaultValue={src.operator_fee || undefined}
        required
        min={0}
        max={2147483647}
      />
      <NumberField
        label={tf('paymentFee')}
        inputRef={payment_feeRef}
        defaultValue={src.payment_fee || undefined}
        required
        min={0}
        max={2147483647}
      />
      <AppFieldSelect
        options={statusOptions}
        value={statusOptions.find((o) => o.value === status) ?? null}
        onChange={(newValue) => setStatus(newValue)}
        label={tf('status')}
        required
      />
      <AppValidationError message={validationError} />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('tipTx') }) : tc('addEntity', { entity: te('tipTx') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('tipTx')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
