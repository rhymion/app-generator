import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getOrganizationListPageData } from '@/lib/organization/getters';
import { removeOrganization } from '@/lib/organization/actions';

export default async function OrganizationListPage() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { organizations, userPermissions } = await getOrganizationListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('organization')}
        src={organizations}
        permissions={userPermissions}
        basePath="/organization"
        removeAction={removeOrganization}
      />
    </>
  );
}
