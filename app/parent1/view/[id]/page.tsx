import FormView from '@/components/parent1/FormView';
import { getParent1Detail } from '@/lib/parent1/getters';
import { Parent1DetailPageProps } from '@/lib/parent1/types';
import { notFound } from 'next/navigation';

export default async function ViewParent1Page({ params }: Parent1DetailPageProps) {
  const { id } = await params;
  const parent1 = await getParent1Detail(id);
  if (!parent1) {
    notFound();
  }
  return <FormView src={parent1} />;
}
