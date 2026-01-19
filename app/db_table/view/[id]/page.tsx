import FormView from '@/components/db_table/FormView';
import { getDbTableDetail } from '@/lib/db_table/getters';
import { DbTableDetailPageProps } from '@/lib/db_table/types';
import { notFound } from 'next/navigation';

export default async function ViewDbTablePage({ params }: DbTableDetailPageProps) {
  const { id } = await params;
  const dbTable = await getDbTableDetail(id);
  if (!dbTable) {
    notFound();
  }
  return <FormView src={dbTable} />;
}
