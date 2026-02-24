import FormView from '@/components/parent1/FormView';
import { getParent1DetailPageData } from '@/lib/parent1/getters';
import { Parent1DetailPageProps } from '@/lib/parent1/types';
import { notFound } from 'next/navigation';

export default async function ViewParent1Page({ params }: Parent1DetailPageProps) {
  const { id } = await params;
  const { parent1, userPermissions } = await getParent1DetailPageData(id);
  if (!parent1) {
    notFound();
  }
  return <FormView src={parent1} permissions={userPermissions} />;
}
