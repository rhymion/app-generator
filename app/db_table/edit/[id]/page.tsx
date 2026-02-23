import FormUpsert from '@/components/db_table/FormUpsert';
import { getDbTableDetailPageData } from '@/lib/db_table/getters';
import { getDbTableListPageData } from '@/lib/db_table/getters';
import { DbTableDetailPageProps } from '@/lib/db_table/types';
import { notFound } from 'next/navigation';

export default async function EditDbTablePage({ params }: DbTableDetailPageProps) {
  const { id } = await params;
  const [detail, dbTablesData] = await Promise.all([
    getDbTableDetailPageData(id, 'update'),
    getDbTableListPageData(false),
  ]);
  if (!detail.dbTable) {
    notFound();
  }
  return <FormUpsert src={detail.dbTable} isEdit={true} permissions={detail.userPermissions} allDbTables={dbTablesData.dbTables} dbTablePermissions={dbTablesData.userPermissions} />;
}
