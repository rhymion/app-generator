import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/resource/FormUpsert';
import { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';
import { getResourceNewPageAccessCheck } from '@/lib/resource/getters';

export default function AddResourcePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ResourceNewContent />
    </Suspense>
  );
}

async function ResourceNewContent() {
  const [userPermissions, organizationsData] = await Promise.all([
    getResourceNewPageAccessCheck(),
    getAssociatedOrganizationListPageData(),
  ]);
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
