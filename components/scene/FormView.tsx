'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/scene/types';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean, AppFieldRelation } from '@/components/ui';
import ChannelBridgeGrid from '../channel/ChannelBridgeGrid';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('scene')}
        editHref={canEdit ? `/scene/edit/${src.id}` : undefined}
        backHref="/scene"
      />
      <AppFieldText
        label={tf('label')}
        value={src.label || ''}
        readOnly
      />
      <AppFieldRelation
        label={tf('work')}
        value={((src.work?.title ?? '')) || src.work_id || ''}
        href={src.work_id ? `/work/view/${src.work_id}` : null}
        readOnly
      />
      <AppFieldText
        label={tf('episode')}
        value={src.episode || ''}
        readOnly
      />
      <AppFieldText
        label={tf('timestamp')}
        value={src.timestamp || ''}
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
          items={src.music.map(f => ({
            id: f.id,
            value: (f.title ?? ''),
            label: (f.title ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('music')}
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
      <ChannelBridgeGrid bridgeId={String((src as Record<string, unknown>).channelable_id ?? '')} parentType="scene" parentId={src.id} title={te('channel')} readOnly />
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
