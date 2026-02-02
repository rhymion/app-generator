import FormUpsert from '@/components/parent1/FormUpsert';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';

export default async function AddParent1Page() {
  const allOrganizations = await getAssociatedOrganizations();
  const src = {
    id: '',
    name: '',
    organization_id: '',
    organization: { id: '', name: '', description: '' },
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
