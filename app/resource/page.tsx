import { getResourceListPageData } from '@/lib/resource/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeResource } from '@/lib/resource/actions';

export default async function ResourcesPage() {
  const { resources, userPermissions } = await getResourceListPageData();
  return <ResponsiveListClient src={resources} basePath="/resource" removeAction={removeResource} entityLabel="Resource"
    permissions={userPermissions} />;
}
