'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/user/types';
import ImageDisplay from '@/components/_standard/ImageDisplay';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean } from '@/components/ui';
import MfaToggle from '@/components/_standard/MfaToggle';

export default function FormView({ src, permissions, currentUserRoleIds, currentUserId }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('user')}
        editHref={canEdit ? `/user/edit/${src.id}` : undefined}
        backHref="/user"
      />
      <AppFieldText
        label={tf('name')}
        value={src.name || ''}
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
      <MfaToggle src={src} permissions={permissions} currentUserRoleIds={currentUserRoleIds} currentUserId={currentUserId} />
    </AppDetailShell>
  );
}
