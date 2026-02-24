import { getXxxxxXxxxxListPageData } from '@/lib/xxxxx_xxxxx/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeXxxxxXxxxx } from '@/lib/xxxxx_xxxxx/actions';

export default async function XxxxxXxxxxsPage() {
  const { xxxxxXxxxxs, userPermissions } = await getXxxxxXxxxxListPageData();
  return <ResponsiveListClient src={xxxxxXxxxxs} basePath="/xxxxx_xxxxx" removeAction={removeXxxxxXxxxx} entityLabel="Xxxxx Xxxxx"
    permissions={userPermissions} />;
}
