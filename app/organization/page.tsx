import { getOrganizationListPageData } from '@/lib/organization/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeOrganization } from '@/lib/organization/actions';

export default async function OrganizationsPage() {
  const { organizations, userPermissions } = await getOrganizationListPageData();
  return <DataGridClient src={organizations} basePath="/organization" removeAction={removeOrganization} entityLabel="Organization" 
    permissions={userPermissions} />;
}
