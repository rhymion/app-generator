import FormUpsert from '@/components/resource/FormUpsert';
import { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';
import { getResourceNewPageAccessCheck } from '@/lib/resource/getters';

export default async function AddResourcePage() {
  const organizationsData = await getAssociatedOrganizationListPageData();
  const userPermissions = await getResourceNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    organization_id: '',
    resource_attachments: [],
    resource_images: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allOrganizations={organizationsData.organizations} organizationPermissions={organizationsData.userPermissions} />;
}
