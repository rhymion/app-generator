import { getTranslations } from 'next-intl/server';
import { getSetting3ListPageData } from '@/lib/setting3/getters';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { removeSetting3 } from '@/lib/setting3/actions';

export default async function Setting3sPage() {
  const { setting3s, userPermissions } = await getSetting3ListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={setting3s} basePath="/setting3" removeAction={removeSetting3} entityLabel={t('setting3')}
    permissions={userPermissions} />;
}
