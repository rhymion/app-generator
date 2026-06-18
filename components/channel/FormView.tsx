'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { FormViewProps } from '@/lib/channel/types';
import CommentListWrapper from '@/components/_standard/CommentListWrapper';
import { addChannelComment, updateChannelComment, deleteChannelComment, toggleChannelCommentReaction } from '@/lib/channel/actions';
import { COMMENT_REACTION_TYPES } from '@/lib/reaction_constants';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean, AppFieldRelation } from '@/components/ui';
import FcLinkBridgeGrid from '../fc_link/FcLinkBridgeGrid';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const kindOptions = [{ value: 0, label: tf('kind_general') }, { value: 1, label: tf('kind_consider') }];
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('channel')}
        editHref={canEdit ? `/channel/edit/${src.id}` : undefined}
        backHref="/channel"
      />
      <AppFieldText
        label={tf('parentType')}
        value={src.parent_type ?? ''}
        readOnly
      />
      <AppFieldText
        label={tf('parentLabel')}
        value={src.parent_label ?? ''}
        readOnly
      />
      <AppFieldText
        label={tf('name')}
        value={src.name || ''}
        readOnly
      />
      <AppFieldRelation
        label={tf('organization')}
        value={((src.organization?.name ?? '')) || src.organization_id || ''}
        href={src.organization_id ? `/organization/view/${src.organization_id}` : null}
        readOnly
      />
      <AppFieldText
        label={tf('kind')}
        value={kindOptions.find(o => o.value === src.kind)?.label ?? ''}
        readOnly
      />
      <CommentListWrapper
        comments={src.commentable?.comments ?? []}
        showTitle={true}
        title={tf('comments')}
        permissions={{ create: false, delete: false }}
        reactionTypes={[...COMMENT_REACTION_TYPES]}
        onToggleReaction={toggleChannelCommentReaction}
      />
      <FcLinkBridgeGrid bridgeId={String((src as Record<string, unknown>).fc_linkable_id ?? '')} parentType="channel" parentId={src.id} title={te('fcLink')} readOnly />
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
