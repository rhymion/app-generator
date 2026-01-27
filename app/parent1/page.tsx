import { getAllParent1s } from '@/lib/parent1/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeParent1 } from '@/lib/parent1/actions';

export default async function Parent1sPage() {
  const parent1s = await getAllParent1s();
  return <DataGridClient src={parent1s} basePath="/parent1" removeAction={removeParent1} entityLabel="Parent1" />;
}
