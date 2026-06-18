'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/user/types';
import ImageDisplay from '@/components/_standard/ImageDisplay';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean } from '@/components/ui';
import MfaToggle from '@/components/_standard/MfaToggle';

export default function FormView({ src, permissions, currentUserRoleIds, currentUserId }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('user')}
        editHref={canEdit ? `/user/edit/${src.id}` : undefined}
        backHref="/user"
      />
      <AppFieldText
        label={tf('name')}
        value={src.name || ''}
        readOnly
      />
      <ImageDisplay url={src.image} alt={tf('image')} />
      <div>
        <ListWrapper
          items={src.roles.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('roles')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.sub_accounts.map(f => ({
            id: f.id,
            value: (f.nickname ?? ''),
            label: (f.nickname ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('subAccounts')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.created_works.map(f => ({
            id: f.id,
            value: (f.title ?? ''),
            label: (f.title ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('createdWorks')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.created_characters.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('createdCharacters')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.created_scenes.map(f => ({
            id: f.id,
            value: (f.label ?? ''),
            label: (f.label ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('createdScenes')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.created_channels.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('createdChannels')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.created_musics.map(f => ({
            id: f.id,
            value: (f.title ?? ''),
            label: (f.title ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('createdMusics')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.created_creators.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('createdCreators')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.created_plans.map(f => ({
            id: f.id,
            value: (['free', 'premium', 'vip'][f.tier] ?? ''),
            label: (['free', 'premium', 'vip'][f.tier] ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('createdPlans')}
        />
      </div>
      <AuditInfo src={src} />
      <MfaToggle src={src} permissions={permissions} currentUserRoleIds={currentUserRoleIds} currentUserId={currentUserId} />
    </AppDetailShell>
  );
}
