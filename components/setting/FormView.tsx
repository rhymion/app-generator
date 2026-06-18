'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/setting/types';
import ImageDisplay from '@/components/_standard/ImageDisplay';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean } from '@/components/ui';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('setting')}
        editHref={canEdit ? `/setting/edit/${src.id}` : undefined}
        backHref="/setting"
      />
      <AppFieldText
        label={tf('name')}
        value={src.name || ''}
        readOnly
      />
      <AppFieldText
        label={tf('email')}
        value={src.email || ''}
        readOnly
      />
      <AppFieldText
        label={tf('password')}
        value={src.password || ''}
        readOnly
      />
      <AppFieldText
        label={tf('apiKey')}
        value={src.api_key || ''}
        readOnly
      />
      <AppFieldBoolean
        label={tf('mfaEnabled')}
        checked={Boolean(src.mfa_enabled)}
        readOnly
      />
      <ImageDisplay url={src.image} alt={tf('image')} />
      <div>
        <ListWrapper
          items={src.roles.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('roles')}
        />
      </div>
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
