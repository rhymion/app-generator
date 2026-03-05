import { getSetting2ListPageData } from '@/lib/setting2/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';

export default async function Setting2sPage() {
  const { setting2s, userPermissions } = await getSetting2ListPageData();
  return <ResponsiveListClient src={setting2s} basePath="/setting2" entityLabel="Setting2"
    permissions={userPermissions} />;
}
