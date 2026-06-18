'use client';

import { useTranslations } from 'next-intl';
import type { FormViewProps } from '@/lib/permission/types';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean, AppFieldRelation } from '@/components/ui';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('permission')}
        editHref={canEdit ? `/permission/edit/${src.id}` : undefined}
        backHref="/permission"
      />
      <AppFieldText
        label={tf('name')}
        value={[{ value: 'user', label: 'User' }, { value: 'setting', label: 'Setting' }, { value: 'role', label: 'Role' }, { value: 'organization', label: 'Organization' }, { value: 'permission', label: 'Permission' }, { value: 'approval_flow', label: 'Approval Flow' }, { value: 'dashboard', label: 'Dashboard' }].find((o) => o.value === src.name)?.label ?? src.name ?? ''}
        readOnly
      />
      <AppFieldRelation
        label={tf('role')}
        value={((src.role?.name ?? '')) || src.role_id || ''}
        href={src.role_id ? `/role/view/${src.role_id}` : null}
        readOnly
      />
      <AppFieldBoolean
        label={tf('create')}
        checked={Boolean(src.create)}
        readOnly
      />
      <AppFieldBoolean
        label={tf('read')}
        checked={Boolean(src.read)}
        readOnly
      />
      <AppFieldBoolean
        label={tf('update')}
        checked={Boolean(src.update)}
        readOnly
      />
      <AppFieldBoolean
        label={tf('delete')}
        checked={Boolean(src.delete)}
        readOnly
      />
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
