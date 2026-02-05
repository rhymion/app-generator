import FormUpsert from '@/components/parent_only/FormUpsert';
import { getParentOnlyDetailPageData } from '@/lib/parent_only/getters';
import { ParentOnlyDetailPageProps } from '@/lib/parent_only/types';
import { notFound } from 'next/navigation';

export default async function EditParentOnlyPage({ params }: ParentOnlyDetailPageProps) {
  const { id } = await params;
  const detail = await getParentOnlyDetailPageData(id, 'update');
  if (!detail.parentOnly) {
    notFound();
  }
  return <FormUpsert src={detail.parentOnly} isEdit={true} />;
}
