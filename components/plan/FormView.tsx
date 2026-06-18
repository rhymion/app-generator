'use client';

import { useTranslations } from 'next-intl';
import type { GridColDef } from '@/components/ui/data';
import type { FormViewProps } from '@/lib/plan/types';
import ListWrapper from '@/components/_standard/ListWrapper';
import AuditInfo from '@/components/_standard/AuditInfo';
import { AppDetailShell, AppDetailHeader, AppFieldText, AppFieldBoolean } from '@/components/ui';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const tierOptions = [{ value: 0, label: tf('tier_free') }, { value: 1, label: tf('tier_premium') }, { value: 2, label: tf('tier_vip') }];
  return (
    <AppDetailShell>
      <AppDetailHeader
        title={te('plan')}
        editHref={canEdit ? `/plan/edit/${src.id}` : undefined}
        backHref="/plan"
      />
      <AppFieldText
        label={tf('reactionKindsAllowed')}
        value={src.reaction_kinds_allowed || ''}
        readOnly
      />
      <AppFieldText
        label={tf('subAccountLimit')}
        value={src.sub_account_limit || ''}
        readOnly
      />
      <AppFieldText
        label={tf('tier')}
        value={tierOptions.find(o => o.value === src.tier)?.label ?? ''}
        readOnly
      />
      <AppFieldBoolean
        label={tf('canViewPaidPosts')}
        checked={Boolean(src.can_view_paid_posts)}
        readOnly
      />
      <div>
        <ListWrapper
          items={src.users.map(f => ({
            id: f.id,
            value: (f.name ?? ''),
            label: (f.name ?? ''),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('users')}
        />
      </div>
      <AuditInfo src={src} />
    </AppDetailShell>
  );
}
