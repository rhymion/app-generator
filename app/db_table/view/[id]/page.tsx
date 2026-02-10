import FormView from '@/components/db_table/FormView';
import { getDbTableDetailPageData } from '@/lib/db_table/getters';
import { DbTableDetailPageProps } from '@/lib/db_table/types';
import { notFound } from 'next/navigation';

export default async function ViewDbTablePage({ params }: DbTableDetailPageProps) {
  const { id } = await params;
  const { dbTable, userPermissions } = await getDbTableDetailPageData(id);
  if (!dbTable) {
    notFound();
  }
  return <FormView src={dbTable} permissions={userPermissions} />;
}
