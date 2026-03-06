import { getTranslations } from 'next-intl/server';
import { getSetting1ListPageData } from '@/lib/setting1/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeSetting1 } from '@/lib/setting1/actions';

export default async function Setting1sPage() {
  const { setting1s, userPermissions } = await getSetting1ListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={setting1s} basePath="/setting1" removeAction={removeSetting1} entityLabel={t('setting1')}
    permissions={userPermissions} />;
}
