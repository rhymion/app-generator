'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/work/types';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean } from '@/components/ui';
import ChannelBridgeGrid from '../channel/ChannelBridgeGrid';
import FcLinkBridgeGrid from '../fc_link/FcLinkBridgeGrid';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const patternOptions = [{ value: 0, label: tf('pattern_A') }, { value: 1, label: tf('pattern_B') }];
  const statusOptions = [{ value: 0, label: tf('status_pending') }, { value: 1, label: tf('status_approved') }];
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('work')}
        editHref={canEdit ? `/work/edit/${src.id}` : undefined}
        backHref="/work"
      />
      <AppFieldText
        label={tf('title')}
        value={src.title || ''}
        readOnly
      />
      <AppFieldText
        label={tf('pattern')}
        value={patternOptions.find(o => o.value === src.pattern)?.label ?? ''}
        readOnly
      />
      <AppFieldText
        label={tf('status')}
        value={statusOptions.find(o => o.value === src.status)?.label ?? ''}
        readOnly
      />
      <div>
        <ListWrapper
          items={src.characters.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('characters')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.scenes.map(f => ({
            id: f.id,
            value: (f.label ?? ''),
            label: (f.label ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('scenes')}
        />
      </div>
      <ChannelBridgeGrid bridgeId={String((src as Record<string, unknown>).channelable_id ?? '')} parentType="work" parentId={src.id} title={te('channel')} readOnly />
      <FcLinkBridgeGrid bridgeId={String((src as Record<string, unknown>).fc_linkable_id ?? '')} parentType="work" parentId={src.id} title={te('fcLink')} readOnly />
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
