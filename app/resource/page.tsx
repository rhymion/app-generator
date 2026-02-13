import { getResourceListPageData } from '@/lib/resource/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeResource } from '@/lib/resource/actions';

export default async function ResourcesPage() {
  const { resources, userPermissions } = await getResourceListPageData();
  return <DataGridClient src={resources} basePath="/resource" removeAction={removeResource} entityLabel="Resource"
    permissions={userPermissions} />;
}
