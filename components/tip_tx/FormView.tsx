'use client';

import { useTranslations } from 'next-intl';
import type { FormViewProps } from '@/lib/tip_tx/types';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean, AppFieldRelation } from '@/components/ui';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const statusOptions = [{ value: 0, label: tf('status_pending') }, { value: 1, label: tf('status_held') }, { value: 2, label: tf('status_paid') }];
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('tipTx')}
        editHref={canEdit ? `/tip_tx/edit/${src.id}` : undefined}
        backHref="/tip_tx"
      />
      <AppFieldText
        label={tf('grossAmount')}
        value={src.gross_amount || ''}
        readOnly
      />
      <AppFieldText
        label={tf('operatorFee')}
        value={src.operator_fee || ''}
        readOnly
      />
      <AppFieldText
        label={tf('paymentFee')}
        value={src.payment_fee || ''}
        readOnly
      />
      <AppFieldText
        label={tf('contractSplitId')}
        value={src.contract_split_id || ''}
        readOnly
      />
      <AppFieldRelation
        label={tf('comment')}
        value={((src.comment?.message ?? '')) || src.comment_id || ''}
        href={src.comment_id ? `/comment/view/${src.comment_id}` : null}
        readOnly
      />
      <AppFieldText
        label={tf('status')}
        value={statusOptions.find(o => o.value === src.status)?.label ?? ''}
        readOnly
      />
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
