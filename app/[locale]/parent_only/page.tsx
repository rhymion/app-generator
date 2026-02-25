import { getParentOnlyListPageData } from '@/lib/parent_only/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeParentOnly } from '@/lib/parent_only/actions';

export default async function ParentOnlysPage() {
  const { parentOnlys, userPermissions } = await getParentOnlyListPageData();
  return <ResponsiveListClient src={parentOnlys} basePath="/parent_only" removeAction={removeParentOnly} entityLabel="Parent Only"
    permissions={userPermissions} />;
}
