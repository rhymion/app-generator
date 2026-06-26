'use client';

import { useTranslations } from 'next-intl';
import type { FormViewProps } from '@/lib/audit_log/types';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean, AppFieldRelation } from '@/components/ui';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('auditLog')}
        editHref={canEdit ? `/audit_log/edit/${src.id}` : undefined}
        backHref="/audit_log"
      />
      <AppFieldText
        label={tf('targetTable')}
        value={src.target_table || ''}
        readOnly
      />
      <AppFieldText
        label={tf('targetId')}
        value={src.target_id || ''}
        readOnly
      />
      <AppFieldText
        label={tf('action')}
        value={src.action || ''}
        readOnly
      />
      <AppFieldRelation
        label={tf('actorUser')}
        value={src.actor_user?.name || ''}
        href={src.actor_user_id ? `/user/view/${src.actor_user_id}` : null}
        readOnly
      />
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
