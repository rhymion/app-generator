import FormUpsert from '@/components/db_table/FormUpsert';
import { getDbTableDetailPageData } from '@/lib/db_table/getters';
import { getSessionUserId } from '@/lib/authz';
import { DbTableDetailPageProps } from '@/lib/db_table/types';
import { notFound } from 'next/navigation';

export default async function EditDbTablePage({ params }: DbTableDetailPageProps) {
  const { id } = await params;
  const detail = await getDbTableDetailPageData(id, 'update');
  const currentUserId = await getSessionUserId();
  if (!detail.dbTable) {
    notFound();
  }
  return <FormUpsert src={detail.dbTable} isEdit={true} permissions={detail.userPermissions} currentUserId={currentUserId} />;
}
