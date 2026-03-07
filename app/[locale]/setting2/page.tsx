import { getTranslations } from 'next-intl/server';
import { getSetting2ListPageData } from '@/lib/setting2/getters';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';

export default async function Setting2sPage() {
  const { setting2s, userPermissions } = await getSetting2ListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={setting2s} basePath="/setting2" entityLabel={t('setting2')}
    permissions={userPermissions} />;
}
