import FormUpsert from '@/components/db_table/FormUpsert';
import { getDbTableDetail } from '@/lib/db_table/getters';
import { notFound } from 'next/navigation';

interface EditPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditDbTablePage({ params }: EditPageProps) {
  const { id } = await params;
  const dbTable = await getDbTableDetail(id);
  if (!dbTable) {
    notFound();
  }
  return <FormUpsert src={dbTable} isEdit={true} />;
}
