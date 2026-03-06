import { getTranslations } from 'next-intl/server';
import { getOrganizationListPageData } from '@/lib/organization/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeOrganization } from '@/lib/organization/actions';

export default async function OrganizationsPage() {
  const { organizations, userPermissions } = await getOrganizationListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={organizations} basePath="/organization" removeAction={removeOrganization} entityLabel={t('organization')}
    permissions={userPermissions} />;
}
