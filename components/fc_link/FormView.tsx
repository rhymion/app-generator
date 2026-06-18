'use client';

import { useTranslations } from 'next-intl';
import type { FormViewProps } from '@/lib/fc_link/types';
import AppFieldExternalLink from '@/components/_standard/AppFieldExternalLink';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean } from '@/components/ui';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('fcLink')}
        editHref={canEdit ? `/fc_link/edit/${src.id}` : undefined}
        backHref="/fc_link"
      />
      <AppFieldText
        label={tf('parentType')}
        value={src.parent_type ?? ''}
        readOnly
      />
      <AppFieldText
        label={tf('parentLabel')}
        value={src.parent_label ?? ''}
        readOnly
      />
      <AppFieldText
        label={tf('name')}
        value={src.name || ''}
        readOnly
      />
      <AppFieldExternalLink label={tf('url')} href={src.url || null} />
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
