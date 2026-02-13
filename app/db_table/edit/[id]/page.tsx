import FormUpsert from '@/components/db_table/FormUpsert';
import { getDbTableDetailPageData } from '@/lib/db_table/getters';
import { DbTableDetailPageProps } from '@/lib/db_table/types';
import { notFound } from 'next/navigation';

export default async function EditDbTablePage({ params }: DbTableDetailPageProps) {
  const { id } = await params;
  const detail = await getDbTableDetailPageData(id, 'update');
  if (!detail.dbTable) {
    notFound();
  }
  return <FormUpsert src={detail.dbTable} isEdit={true} permissions={detail.userPermissions} />;
}
