import { getAllOrganizations } from '@/lib/organization/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeOrganization } from '@/lib/organization/actions';

export default async function OrganizationsPage() {
  const organizations = await getAllOrganizations();
  return <DataGridClient src={organizations} basePath="/organization" removeAction={removeOrganization} entityLabel="Organization" />;
}
