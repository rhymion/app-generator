import { getTranslations } from 'next-intl/server';
import { getParentOnlyListPageData } from '@/lib/parent_only/getters';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { removeParentOnly } from '@/lib/parent_only/actions';

export default async function ParentOnlysPage() {
  const { parentOnlys, userPermissions } = await getParentOnlyListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={parentOnlys} basePath="/parent_only" removeAction={removeParentOnly} entityLabel={t('parentOnly')}
    permissions={userPermissions} />;
}
