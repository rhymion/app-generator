'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import NumberField from '@/components/_standard/NumberField';
import { upsertPlan, removePlan } from '@/lib/plan/actions';
import type { FormUpsertProps } from '@/lib/plan/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError, AppFieldSelect } from '@/components/ui';
import type { User } from '@/lib/user/types';
import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialUsers = [], searchUserOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [canViewPaidPosts, setCanViewPaidPosts] = useState<boolean>(Boolean(src.can_view_paid_posts));
  const [tier, setTier] = useState<number | null>(src.tier ?? null);
  const usersRef = useRef<{ getItems: () => EditableListWrapperItem[] }>(null);
  const reaction_kinds_allowedRef = useRef<HTMLInputElement>(null);
  const sub_account_limitRef = useRef<HTMLInputElement>(null);
  const tierOptions = [{ value: 0, label: tf('tier_free') }, { value: 1, label: tf('tier_premium') }, { value: 2, label: tf('tier_vip') }];
  const [localInitialUsers] = useState<EditableListWrapperItem[]>(() => src.users.map(f => ({
    id: f.id || `temp-${Date.now()}-${Math.random()}`,
    value: f.id,
    label: (f.name ?? ''),
    originalId: f.id,
  })));
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    reaction_kinds_allowed: reaction_kinds_allowedRef.current?.value || '',
    sub_account_limit: sub_account_limitRef.current?.value || '',
    can_view_paid_posts: canViewPaidPosts,
    tier: tier,
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
    formData.set('reaction_kinds_allowed', reaction_kinds_allowedRef.current?.value || '');
    formData.set('sub_account_limit', sub_account_limitRef.current?.value || '');
    formData.set('tier', tier !== null ? String(tier) : '');
    formData.set('can_view_paid_posts', canViewPaidPosts.toString());
    const users = usersRef.current?.getItems?.() || [];

    users.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        'user[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });

    try {
      startTransition(async () => {
        await upsertPlan(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removePlan([src.id]);
  };

  const handleBack = () => {
    router.push('/plan');
  };

  const formFields = (
    <>
      <NumberField
        label={tf('reactionKindsAllowed')}
        inputRef={reaction_kinds_allowedRef}
        defaultValue={src.reaction_kinds_allowed || undefined}
        required
        min={0}
        max={2147483647}
      />
      <NumberField
        label={tf('subAccountLimit')}
        inputRef={sub_account_limitRef}
        defaultValue={src.sub_account_limit || undefined}
        required
        min={0}
        max={2147483647}
      />
      <AppFieldSelect
        options={tierOptions}
        value={tierOptions.find((o) => o.value === tier) ?? null}
        onChange={(newValue) => setTier(newValue)}
        label={tf('tier')}
        required
      />
      <AppFieldBoolean
        label={tf('canViewPaidPosts')}
        checked={canViewPaidPosts}
        onChange={(e) => setCanViewPaidPosts(e.target.checked)}
      />
      <EditableListWrapper
        ref={usersRef}
        initialItems={localInitialUsers}
        itemType="autocomplete"
        addButtonLabel="Add Users"
        showTitle={true}
        title={tf('users')}
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        searchOptions={async (query, includeIds) => {
          const rows = (await searchUserOptions?.(query, includeIds)) ?? [];
          return rows.map(item => ({ id: item.id, label: (item.name ?? '') }));
        }}
        initialAutocompleteOptions={(initialUsers ?? []).map(item => ({
          id: item.id,
          label: (item.name ?? ''),
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
        title={isEdit ? tc('editEntity', { entity: te('plan') }) : tc('addEntity', { entity: te('plan') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('plan')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
