import { getXxxxxXxxxxListPageData } from '@/lib/xxxxx_xxxxx/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeXxxxxXxxxx } from '@/lib/xxxxx_xxxxx/actions';

export default async function XxxxxXxxxxsPage() {
  const { xxxxxXxxxxs, userPermissions } = await getXxxxxXxxxxListPageData();
  return <DataGridClient src={xxxxxXxxxxs} basePath="/xxxxx_xxxxx" removeAction={removeXxxxxXxxxx} entityLabel="Xxxxx Xxxxx" 
    permissions={userPermissions} />;
}
