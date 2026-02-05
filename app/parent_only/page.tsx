import { getParentOnlyListPageData } from '@/lib/parent_only/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeParentOnly } from '@/lib/parent_only/actions';

export default async function ParentOnlysPage() {
  const { parentOnlys, userPermissions } = await getParentOnlyListPageData();
  return <DataGridClient src={parentOnlys} basePath="/parent_only" removeAction={removeParentOnly} entityLabel="Parent Only" 
    permissions={userPermissions} />;
}
