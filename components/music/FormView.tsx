'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/music/types';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean } from '@/components/ui';
import FcLinkBridgeGrid from '../fc_link/FcLinkBridgeGrid';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const kindOptions = [{ value: 0, label: tf('kind_op') }, { value: 1, label: tf('kind_cd') }, { value: 2, label: tf('kind_bgm') }, { value: 3, label: tf('kind_insert') }];
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('music')}
        editHref={canEdit ? `/music/edit/${src.id}` : undefined}
        backHref="/music"
      />
      <AppFieldText
        label={tf('title')}
        value={src.title || ''}
        readOnly
      />
      <AppFieldText
        label={tf('kind')}
        value={kindOptions.find(o => o.value === src.kind)?.label ?? ''}
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
          items={src.composers.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('composers')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.credits.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('credits')}
        />
      </div>
      <FcLinkBridgeGrid bridgeId={String((src as Record<string, unknown>).fc_linkable_id ?? '')} parentType="music" parentId={src.id} title={te('fcLink')} readOnly />
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
