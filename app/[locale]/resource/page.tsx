import { getTranslations } from 'next-intl/server';
import { getResourceListPageData } from '@/lib/resource/getters';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { removeResource } from '@/lib/resource/actions';

export default async function ResourcesPage() {
  const { resources, userPermissions } = await getResourceListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={resources} basePath="/resource" removeAction={removeResource} entityLabel={t('resource')}
    permissions={userPermissions} />;
}
