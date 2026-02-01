import FormUpsert from '@/components/parent1/FormUpsert';
import { getAllOrganizations } from '@/lib/organization/getters';

export default async function AddParent1Page() {
  const allOrganizations = await getAllOrganizations();
  const src = {
    id: '',
    name: '',
    organization_id: '',
    description: '',
    price: 0,
    due_date: new Date(),
    image_url: '',
    parent1_child1s: [],
    parent1_child2s: [],
    parent1_lists: [],
  };
  return <FormUpsert src={src} isEdit={false} allOrganizations={allOrganizations} />;
}
