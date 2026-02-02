import FormUpsert from '@/components/parent1/FormUpsert';
import { getParent1Detail } from '@/lib/parent1/getters';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';
import { Parent1DetailPageProps } from '@/lib/parent1/types';
import { notFound } from 'next/navigation';

export default async function EditParent1Page({ params }: Parent1DetailPageProps) {
  const { id } = await params;
  const [parent1, allOrganizations] = await Promise.all([
    getParent1Detail(id),
    getAssociatedOrganizations(),
  ]);
  if (!parent1) {
    notFound();
  }
  return <FormUpsert src={parent1} isEdit={true} allOrganizations={allOrganizations} />;
}
