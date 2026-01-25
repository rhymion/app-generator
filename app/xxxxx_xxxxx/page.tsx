import { getAllXxxxxXxxxxs } from '@/lib/xxxxx_xxxxx/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeXxxxxXxxxx } from '@/lib/xxxxx_xxxxx/actions';

export default async function XxxxxXxxxxsPage() {
  const xxxxx_xxxxxs = await getAllXxxxxXxxxxs();
  return <DataGridClient src={xxxxx_xxxxxs} basePath="/xxxxx_xxxxx" removeAction={removeXxxxxXxxxx} entityLabel="Xxxxx Xxxxx" />;
}
