'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/creator/types';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean } from '@/components/ui';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const roleOptions = [{ value: 0, label: tf('role_voice') }, { value: 1, label: tf('role_anim') }, { value: 2, label: tf('role_bgm') }, { value: 3, label: tf('role_etc') }];
  const affiliationOptions = [{ value: 0, label: tf('affiliation_agency') }, { value: 1, label: tf('affiliation_freelance') }, { value: 2, label: tf('affiliation_student') }];
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('creator')}
        editHref={canEdit ? `/creator/edit/${src.id}` : undefined}
        backHref="/creator"
      />
      <AppFieldText
        label={tf('name')}
        value={src.name || ''}
        readOnly
      />
      <AppFieldText
        label={tf('role')}
        value={roleOptions.find(o => o.value === src.role)?.label ?? ''}
        readOnly
      />
      <AppFieldText
        label={tf('affiliation')}
        value={affiliationOptions.find(o => o.value === src.affiliation)?.label ?? ''}
        readOnly
      />
      <div>
        <ListWrapper
          items={src.voiced_characters.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('voicedCharacters')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.composed_musics.map(f => ({
            id: f.id,
            value: (f.title ?? ''),
            label: (f.title ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('composedMusics')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.credited_musics.map(f => ({
            id: f.id,
            value: (f.title ?? ''),
            label: (f.title ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('creditedMusics')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.credited_scenes.map(f => ({
            id: f.id,
            value: (f.label ?? ''),
            label: (f.label ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('creditedScenes')}
        />
      </div>
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
