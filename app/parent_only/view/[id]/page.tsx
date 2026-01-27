import FormView from '@/components/parent_only/FormView';
import { getParentOnlyDetail } from '@/lib/parent_only/getters';
import { ParentOnlyDetailPageProps } from '@/lib/parent_only/types';
import { notFound } from 'next/navigation';

export default async function ViewParentOnlyPage({ params }: ParentOnlyDetailPageProps) {
  const { id } = await params;
  const parent_only = await getParentOnlyDetail(id);
  if (!parent_only) {
    notFound();
  }
  return <FormView src={parent_only} />;
}
