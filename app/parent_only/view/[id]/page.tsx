import FormView from '@/components/parent_only/FormView';
import { getParentOnlyDetailPageData } from '@/lib/parent_only/getters';
import { ParentOnlyDetailPageProps } from '@/lib/parent_only/types';
import { notFound } from 'next/navigation';

export default async function ViewParentOnlyPage({ params }: ParentOnlyDetailPageProps) {
  const { id } = await params;
  const { parentOnly, userPermissions } = await getParentOnlyDetailPageData(id);
  if (!parentOnly) {
    notFound();
  }
  return <FormView src={parentOnly} permissions={userPermissions} />;
}
