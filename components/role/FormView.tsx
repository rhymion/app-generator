'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/role/types';
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
        title={te('role')}
        editHref={canEdit ? `/role/edit/${src.id}` : undefined}
        backHref="/role"
      />
      <AppFieldText
        label={tf('name')}
        value={src.name || ''}
        readOnly
      />
      <AppFieldText
        label={tf('description')}
        value={src.description || ''}
        readOnly
      />
      <div>
        <ListWrapper
          items={src.users.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('users')}
        />
      </div>
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
