'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/dashboard/types';
import FieldsViewGrid from '@/components/_standard/FieldsViewGrid';
import { useWidgetsColumns } from '../dashboard/column_def';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean } from '@/components/ui';
import DashboardView from '@/components/_standard/DashboardView';

export default function FormView({ src, permissions, currentUserRoleIds, currentUserId }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const widgetsColumns: GridColDef[] = useWidgetsColumns(false);
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('dashboard')}
        editHref={canEdit ? `/dashboard/edit/${src.id}` : undefined}
        backHref="/dashboard"
      />
      <AppFieldText
        label={tf('name')}
        value={src.name || ''}
        readOnly
      />
      <div>
        <h2>{tf('widgets')}</h2>
        <FieldsViewGrid fields={src.widgets} columns={widgetsColumns} />
      </div>
      <AuditInfo src={src} />
      <DashboardView src={src} permissions={permissions} currentUserRoleIds={currentUserRoleIds} currentUserId={currentUserId} />
    </AppDetailShell>
  );
}
