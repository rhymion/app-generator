import { getTranslations } from 'next-intl/server';
import { getDbTableListPageData } from '@/lib/db_table/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeDbTable } from '@/lib/db_table/actions';

export default async function DbTablesPage() {
  const { dbTables, userPermissions } = await getDbTableListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={dbTables} basePath="/db_table" removeAction={removeDbTable} entityLabel={t('dbTable')}
    permissions={userPermissions} />;
}
