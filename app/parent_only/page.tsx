import { getAllParentOnlys } from '@/lib/parent_only/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeParentOnly } from '@/lib/parent_only/actions';

export default async function ParentOnlysPage() {
  const parent_onlys = await getAllParentOnlys();
  return <DataGridClient src={parent_onlys} basePath="/parent_only" removeAction={removeParentOnly} entityLabel="Parent Only" />;
}
