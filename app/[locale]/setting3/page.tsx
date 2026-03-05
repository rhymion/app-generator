import { getSetting3ListPageData } from '@/lib/setting3/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeSetting3 } from '@/lib/setting3/actions';

export default async function Setting3sPage() {
  const { setting3s, userPermissions } = await getSetting3ListPageData();
  return <ResponsiveListClient src={setting3s} basePath="/setting3" removeAction={removeSetting3} entityLabel="Setting3"
    permissions={userPermissions} />;
}
