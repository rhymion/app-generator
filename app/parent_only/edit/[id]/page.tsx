import FormUpsert from '@/components/parent_only/FormUpsert';
import { getParentOnlyDetail } from '@/lib/parent_only/getters';
import { ParentOnlyDetailPageProps } from '@/lib/parent_only/types';
import { notFound } from 'next/navigation';

export default async function EditParentOnlyPage({ params }: ParentOnlyDetailPageProps) {
  const { id } = await params;
  const parent_only = await getParentOnlyDetail(id);
  if (!parent_only) {
    notFound();
  }
  return <FormUpsert src={parent_only} isEdit={true} />;
}
