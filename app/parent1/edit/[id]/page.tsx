import FormUpsert from '@/components/parent1/FormUpsert';
import { getParent1Detail } from '@/lib/parent1/getters';
import { Parent1DetailPageProps } from '@/lib/parent1/types';
import { notFound } from 'next/navigation';

export default async function EditParent1Page({ params }: Parent1DetailPageProps) {
  const { id } = await params;
  const parent1 = await getParent1Detail(id);
  if (!parent1) {
    notFound();
  }
  return <FormUpsert src={parent1} isEdit={true} />;
}
