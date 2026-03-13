import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/parent1/FormUpsert';
import { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';
import { getParent1NewPageAccessCheck } from '@/lib/parent1/getters';

export default function AddParent1Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Parent1NewContent />
    </Suspense>
  );
}

async function Parent1NewContent() {
  const [userPermissions, organizationsData] = await Promise.all([
    getParent1NewPageAccessCheck(),
    getAssociatedOrganizationListPageData(),
  ]);
  const src = {
    id: '',
    name: '',
    organization_id: '',
    description: '',
    price: 0,
    due_date: null,
    image_url: '',
    parent1_child1s: [],
    parent1_child2s: [],
    parent1_lists: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allOrganizations={organizationsData.organizations} organizationPermissions={organizationsData.userPermissions} />;
}
