'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/character/types';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean, AppFieldRelation } from '@/components/ui';
import ChannelBridgeGrid from '../channel/ChannelBridgeGrid';
import FcLinkBridgeGrid from '../fc_link/FcLinkBridgeGrid';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('character')}
        editHref={canEdit ? `/character/edit/${src.id}` : undefined}
        backHref="/character"
      />
      <AppFieldText
        label={tf('name')}
        value={src.name || ''}
        readOnly
      />
      <AppFieldRelation
        label={tf('work')}
        value={((src.work?.title ?? '')) || src.work_id || ''}
        href={src.work_id ? `/work/view/${src.work_id}` : null}
        readOnly
      />
      <AppFieldBoolean
        label={tf('officialImage')}
        checked={Boolean(src.official_image)}
        readOnly
      />
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
      <div>
        <ListWrapper
          items={src.creators.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('creators')}
        />
      </div>
      <ChannelBridgeGrid bridgeId={String((src as Record<string, unknown>).channelable_id ?? '')} parentType="character" parentId={src.id} title={te('channel')} readOnly />
      <FcLinkBridgeGrid bridgeId={String((src as Record<string, unknown>).fc_linkable_id ?? '')} parentType="character" parentId={src.id} title={te('fcLink')} readOnly />
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
