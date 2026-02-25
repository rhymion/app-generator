import FormUpsert from '@/components/parent1/FormUpsert';
import { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';
import { getParent1NewPageAccessCheck } from '@/lib/parent1/getters';

export default async function AddParent1Page() {
  const organizationsData = await getAssociatedOrganizationListPageData();
  const userPermissions =await getParent1NewPageAccessCheck();
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
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allOrganizations={organizationsData.organizations} organizationPermissions={organizationsData.userPermissions} />;
}
