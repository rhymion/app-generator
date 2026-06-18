'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/approval_flow/types';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean, AppFieldRelation } from '@/components/ui';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('approvalFlow')}
        editHref={canEdit ? `/approval_flow/edit/${src.id}` : undefined}
        backHref="/approval_flow"
      />
      <AppFieldText
        label={tf('entityName')}
        value={[{ value: 'user', label: 'User' }, { value: 'setting', label: 'Setting' }, { value: 'role', label: 'Role' }, { value: 'organization', label: 'Organization' }, { value: 'permission', label: 'Permission' }, { value: 'approval_flow', label: 'Approval Flow' }, { value: 'dashboard', label: 'Dashboard' }].find((o) => o.value === src.entity_name)?.label ?? src.entity_name ?? ''}
        readOnly
      />
      <AppFieldRelation
        label={tf('requestorRole')}
        value={((src.requestor_role?.name ?? '')) || src.requestor_role_id || ''}
        href={src.requestor_role_id ? `/role/view/${src.requestor_role_id}` : null}
        readOnly
      />
      <AppFieldRelation
        label={tf('approverRole')}
        value={((src.approver_role?.name ?? '')) || src.approver_role_id || ''}
        href={src.approver_role_id ? `/role/view/${src.approver_role_id}` : null}
        readOnly
      />
      <div>
        <ListWrapper
          items={src.preceded_by.map(f => ({
            id: f.id,
            value: (f.approver_role?.name || ((f.entity_name ?? ''))),
            label: (f.approver_role?.name || ((f.entity_name ?? ''))),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('precededBy')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.followed_by.map(f => ({
            id: f.id,
            value: (f.approver_role?.name || ((f.entity_name ?? ''))),
            label: (f.approver_role?.name || ((f.entity_name ?? ''))),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('followedBy')}
        />
      </div>
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
