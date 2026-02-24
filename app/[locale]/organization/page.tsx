import { getOrganizationListPageData } from '@/lib/organization/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeOrganization } from '@/lib/organization/actions';

export default async function OrganizationsPage() {
  const { organizations, userPermissions } = await getOrganizationListPageData();
  return <ResponsiveListClient src={organizations} basePath="/organization" removeAction={removeOrganization} entityLabel="Organization"
    permissions={userPermissions} />;
}
