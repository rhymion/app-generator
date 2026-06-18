'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { upsertChannel, removeChannel, addChannelComment, updateChannelComment, deleteChannelComment, toggleChannelCommentReaction } from '@/lib/channel/actions';
import { COMMENT_REACTION_TYPES } from '@/lib/reaction_constants';
import type { FormUpsertProps } from '@/lib/channel/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppFieldText, AppFieldBoolean, AppValidationError, AppFieldRelation, AppFieldSelect } from '@/components/ui';
import CommentListWrapper from '@/components/_standard/CommentListWrapper';
import FcLinkBridgeGrid from '../fc_link/FcLinkBridgeGrid';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, currentUserId, initialOrganizations = [], initialWorks = [], initialCharacters = [], initialScenes = [], searchOrganizationOptions, searchWorkOptions, searchCharacterOptions, searchSceneOptions, initialParentType, initialParentId }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [kind, setKind] = useState<number | null>(src.kind ?? null);
  const [organizationId, setOrganizationId] = useState<string | null>(src.organization_id || null);
  const nameRef = useRef<HTMLInputElement>(null);
  const selectedParentTypeRef = useRef<HTMLInputElement>(null);
  const selectedParentIdRef = useRef<HTMLInputElement>(null);
  const kindOptions = [{ value: 0, label: tf('kind_general') }, { value: 1, label: tf('kind_consider') }];
  const organizationIdInitialOptions = useMemo(() => (initialOrganizations ?? []).map((item) => ({
    id: item.id,
    label: (item.name ?? ''),
  })), [initialOrganizations]);
  const organizationIdSearchAction = useCallback(async (query: string, includeIds: string[]) => {
    const rows = (await searchOrganizationOptions?.(query, includeIds)) ?? [];
    return rows.map((item) => ({ id: item.id, label: (item.name ?? '') }));
  }, [searchOrganizationOptions]);
  const organizationIdCurrentOption = useMemo(() => (
    src.organization ? { id: src.organization.id, label: (src.organization?.name ?? '') } : null
  ), [src.organization]);
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    name: nameRef.current?.value || '',
    organization_id: organizationId,
    kind: kind,
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
    formData.set('name', nameRef.current?.value || '');
    formData.set('organization_id', organizationId || '');
    formData.set('kind', kind !== null ? String(kind) : '');
    formData.set('selectedParentType', selectedParentTypeRef.current?.value || '');
    formData.set('selectedParentId', selectedParentIdRef.current?.value || '');

    try {
      startTransition(async () => {
        await upsertChannel(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removeChannel([src.id]);
  };

  const handleBack = () => {
    router.push('/channel');
  };

  const handleCreateComment = async (message: string) => {
    await addChannelComment(src.commentable!.id, message);
    router.refresh();
  };

  const handleUpdateComment = async (commentId: string, message: string) => {
    await updateChannelComment(commentId, message);
    router.refresh();
  };

  const handleDeleteComment = async (commentId: string) => {
    await deleteChannelComment(commentId);
    router.refresh();
  };

  const formFields = (
    <>
      {/* bridge-parent: channelable — set by parent-embedded create, not switchable */}
      {isEdit ? (
        <>
          <AppFieldText label={tf('parentType')} value={src.parent_type ?? ''} readOnly />
          <AppFieldText label={tf('parentLabel')} value={src.parent_label ?? ''} readOnly />
        </>
      ) : (
        <>
          <input type="hidden" ref={selectedParentTypeRef} defaultValue={initialParentType ?? ''} />
          <input type="hidden" ref={selectedParentIdRef} defaultValue={initialParentId ?? ''} />
        </>
      )}
      <AppFieldText
        label={tf('name')}
        inputRef={nameRef}
        defaultValue={src.name || ''}
        required
        minLength={1}
        multiline={false}
        rows={undefined}
      />
      <AppFieldRelation
        label={tf('organization')}
        value={organizationId}
        onChange={(id) => setOrganizationId(id)}
        searchAction={organizationIdSearchAction}
        initialOptions={organizationIdInitialOptions}
        currentOption={organizationIdCurrentOption}
        href={organizationId ? `/organization/view/${organizationId}` : null}
        required={true}
      />
      <AppFieldSelect
        options={kindOptions}
        value={kindOptions.find((o) => o.value === kind) ?? null}
        onChange={(newValue) => setKind(newValue)}
        label={tf('kind')}
        required
      />
      {isEdit && (
        <FcLinkBridgeGrid
          bridgeId={String((src as Record<string, unknown>).fc_linkable_id ?? '')}
          parentType="channel"
          parentId={src.id}
          title={te('fcLink')}
        />
      )}
      <AppValidationError message={validationError} />
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('channel') }) : tc('addEntity', { entity: te('channel') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('channel')}
        submitButtonLabel={tc('save')}
        error={error}
      />
      {isEdit && (
        <CommentListWrapper
          comments={src.commentable?.comments ?? []}
          showTitle={true}
          title={tf('comments')}
          currentUserId={currentUserId}
          permissions={{ create: permissions?.update ?? false, delete: permissions?.update ?? false }}
          onCreateComment={handleCreateComment}
          onUpdateComment={handleUpdateComment}
          onDeleteComment={handleDeleteComment}
          reactionTypes={[...COMMENT_REACTION_TYPES]}
          onToggleReaction={toggleChannelCommentReaction}
        />
      )}
    </>
  );
}
