'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertDashboard, removeDashboard } from '@/lib/dashboard/actions';
import type { FormUpsertProps } from '@/lib/dashboard/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError } from '@/components/ui';
import type { GridRowsProp } from '@/components/ui/data';
import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';
import OrderedFieldsDataGrid from '@/components/_standard/OrderedFieldsDataGrid';
import { useWidgetsColumns } from '../dashboard/column_def';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);
  const widgetsRef = useRef<{ getFields: () => GridRowsProp }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const widgetsColumns = useWidgetsColumns(true);

  const [localInitialWidgets] = useState<GridRowsProp>(() => src.widgets.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` })));

  const createNewWidgets = () => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    entity_name: '',
    chart_type: 1,
    stack_mode: null,
    series_field: '',
    group_by_bucket: null,
    group_by_field: '',
    filter_field: '',
    filter_value: '',
    order: 0,
    dashboard_id: src.id,
  });
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    name: nameRef.current?.value || '',
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;
    const validationMessage = getValidationError();
    setValidationError(validationMessage);
    if (validationMessage) {
      return;
    }

    const invalidWidgets = (widgetsRef.current?.getFields?.() || []).filter((row: Record<string, unknown>) =>
      ['name', 'entity_name', 'chart_type', 'group_by_field'].some((prop: string) => row[prop] == null || row[prop] === '')
    );
    if (invalidWidgets.length > 0) {
      setError('Widgets: required fields (name, entity_name, chart_type, group_by_field) must be filled for all rows.');
      return;
    }

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('name', nameRef.current?.value || '');
    const widgets = widgetsRef.current?.getFields?.() || [];

    (widgets as GridRowsProp).forEach((field) => {
      formData.append(
        'widget[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
          name: field.name,
          entity_name: field.entity_name,
          chart_type: field.chart_type,
          stack_mode: field.stack_mode,
          series_field: field.series_field,
          group_by_bucket: field.group_by_bucket,
          group_by_field: field.group_by_field,
          filter_field: field.filter_field,
          filter_value: field.filter_value,
          order: field.order,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertDashboard(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeDashboard([src.id]);
  };

  const handleBack = () => {
    router.push('/dashboard');
  };

  const formFields = (
    <>
      <AppFieldText
        label={tf('name')}
        inputRef={nameRef}
        defaultValue={src.name || ''}
        required
        minLength={1}
        multiline={false}
        rows={undefined}
      />
      <OrderedFieldsDataGrid
        ref={widgetsRef}
        initialFields={localInitialWidgets}
        columns={widgetsColumns}
        createNewRow={createNewWidgets}
        addButtonLabel="Add Widgets"
        deleteDialogTitle="Delete Selected Widgets?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title={tf('widgets')}
      />
      <AppValidationError message={validationError} />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('dashboard') }) : tc('addEntity', { entity: te('dashboard') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('dashboard')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
