'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertApprovalFlow, removeApprovalFlow } from '@/lib/approval_flow/actions';
import type { FormUpsertProps } from '@/lib/approval_flow/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError, AppFieldRelation, AppFieldSelect } from '@/components/ui';
import type { ApprovalFlow } from '@/lib/approval_flow/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialApprovalFlows = [], initialRoles = [], searchApprovalFlowOptions, searchRoleOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [requestorRoleId, setRequestorRoleId] = useState<string | null>(src.requestor_role_id || null);
  const [approverRoleId, setApproverRoleId] = useState<string | null>(src.approver_role_id || null);
  const [entityName, setEntityName] = useState<string | null>(src.entity_name || null);
  const precededByRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const followedByRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const entityNameOptions = [{ value: 'user', label: 'User' }, { value: 'setting', label: 'Setting' }, { value: 'role', label: 'Role' }, { value: 'organization', label: 'Organization' }, { value: 'permission', label: 'Permission' }, { value: 'approval_flow', label: 'Approval Flow' }, { value: 'dashboard', label: 'Dashboard' }, { value: 'plan', label: 'Plan' }, { value: 'work', label: 'Work' }, { value: 'character', label: 'Character' }, { value: 'scene', label: 'Scene' }, { value: 'music', label: 'Music' }, { value: 'creator', label: 'Creator' }, { value: 'channel', label: 'Channel' }, { value: 'fc_link', label: 'Fc Link' }, { value: 'tip_tx', label: 'Tip Tx' }];
  const requestorRoleIdInitialOptions = useMemo(() => (initialRoles ?? []).map((item) => ({
    id: item.id,
    label: (item.name ?? ''),
  })), [initialRoles]);
  const requestorRoleIdSearchAction = useCallback(async (query: string, includeIds: string[]) => {
    const rows = (await searchRoleOptions?.(query, includeIds)) ?? [];
    return rows.map((item) => ({ id: item.id, label: (item.name ?? '') }));
  }, [searchRoleOptions]);
  const requestorRoleIdCurrentOption = useMemo(() => (
    src.requestor_role ? { id: src.requestor_role.id, label: (src.requestor_role?.name ?? '') } : null
  ), [src.requestor_role]);
  const approverRoleIdInitialOptions = useMemo(() => (initialRoles ?? []).map((item) => ({
    id: item.id,
    label: (item.name ?? ''),
  })), [initialRoles]);
  const approverRoleIdSearchAction = useCallback(async (query: string, includeIds: string[]) => {
    const rows = (await searchRoleOptions?.(query, includeIds)) ?? [];
    return rows.map((item) => ({ id: item.id, label: (item.name ?? '') }));
  }, [searchRoleOptions]);
  const approverRoleIdCurrentOption = useMemo(() => (
    src.approver_role ? { id: src.approver_role.id, label: (src.approver_role?.name ?? '') } : null
  ), [src.approver_role]);
  const [localInitialPrecededBy] = useState<EditableListWrapperItem[]>(() => src.preceded_by.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.entity_name ?? '') + (f.approver_role ? ` - ${f.approver_role.name}` : ''),
    originalId: f.id,
  })));
  const [localInitialFollowedBy] = useState<EditableListWrapperItem[]>(() => src.followed_by.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.entity_name ?? '') + (f.approver_role ? ` - ${f.approver_role.name}` : ''),
    originalId: f.id,
  })));
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    requestor_role_id: requestorRoleId,
    approver_role_id: approverRoleId,
    entity_name: entityName,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;
    const validationMessage = getValidationError();
    setValidationError(validationMessage);
    if (validationMessage) {
      return;
    }

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('entity_name', entityName || '');
    formData.set('requestor_role_id', requestorRoleId || '');
    formData.set('approver_role_id', approverRoleId || '');
    const precededBy = precededByRef.current?.getItems?.() || [];

    precededBy.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'preceded_by[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });
    const followedBy = followedByRef.current?.getItems?.() || [];

    followedBy.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'followed_by[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertApprovalFlow(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeApprovalFlow([src.id]);
  };

  const handleBack = () => {
    router.push('/approval_flow');
  };

  const formFields = (
    <>
      <AppFieldSelect
        options={entityNameOptions}
        value={entityNameOptions.find((o) => o.value === entityName) ?? null}
        onChange={(newValue) => setEntityName(newValue)}
        label={tf('entityName')}
        required
      />
      <AppFieldRelation
        label={tf('requestorRole')}
        value={requestorRoleId}
        onChange={(id) => setRequestorRoleId(id)}
        searchAction={requestorRoleIdSearchAction}
        initialOptions={requestorRoleIdInitialOptions}
        currentOption={requestorRoleIdCurrentOption}
        href={requestorRoleId ? `/role/view/${requestorRoleId}` : null}
        required={false}
      />
      <AppFieldRelation
        label={tf('approverRole')}
        value={approverRoleId}
        onChange={(id) => setApproverRoleId(id)}
        searchAction={approverRoleIdSearchAction}
        initialOptions={approverRoleIdInitialOptions}
        currentOption={approverRoleIdCurrentOption}
        href={approverRoleId ? `/role/view/${approverRoleId}` : null}
        required={true}
      />
      <EditableListWrapper
        ref={precededByRef}
        initialItems={localInitialPrecededBy}
        itemType="autocomplete"
        addButtonLabel="Add Preceded By"
        showTitle={true}
        title={tf('precededBy')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        searchOptions={async (query, includeIds) => {
          const rows = (await searchApprovalFlowOptions?.(query, includeIds)) ?? [];
          return rows.map(item => ({ id: item.id, label: (item.entity_name ?? '') + (item.approver_role ? ` - ${item.approver_role.name}` : '') }));
        }}
        initialAutocompleteOptions={(initialApprovalFlows ?? []).map(item => ({
          id: item.id,
          label: (item.entity_name ?? '') + (item.approver_role ? ` - ${item.approver_role.name}` : ''),
        }))}
        excludeOptionIds={[src.id]}
      />
      <EditableListWrapper
        ref={followedByRef}
        initialItems={localInitialFollowedBy}
        itemType="autocomplete"
        addButtonLabel="Add Followed By"
        showTitle={true}
        title={tf('followedBy')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        searchOptions={async (query, includeIds) => {
          const rows = (await searchApprovalFlowOptions?.(query, includeIds)) ?? [];
          return rows.map(item => ({ id: item.id, label: (item.entity_name ?? '') + (item.approver_role ? ` - ${item.approver_role.name}` : '') }));
        }}
        initialAutocompleteOptions={(initialApprovalFlows ?? []).map(item => ({
          id: item.id,
          label: (item.entity_name ?? '') + (item.approver_role ? ` - ${item.approver_role.name}` : ''),
        }))}
        excludeOptionIds={[src.id]}
      />
      <AppValidationError message={validationError} />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('approvalFlow') }) : tc('addEntity', { entity: te('approvalFlow') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('approvalFlow')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
