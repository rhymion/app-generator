import { getTranslations } from 'next-intl/server';
import { getSetting4ListPageData } from '@/lib/setting4/getters';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';

export default async function Setting4sPage() {
  const { setting4s, userPermissions } = await getSetting4ListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={setting4s} basePath="/setting4" entityLabel={t('setting4')}
    permissions={userPermissions} />;
}
