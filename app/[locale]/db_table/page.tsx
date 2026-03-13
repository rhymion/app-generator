import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getDbTableListPageData } from '@/lib/db_table/getters';
import { removeDbTable } from '@/lib/db_table/actions';

export default function DbTableListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <DbTableListContent />
    </Suspense>
  );
}

async function DbTableListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { dbTables, userPermissions } = await getDbTableListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('dbTable')}
        src={dbTables}
        permissions={userPermissions}
        basePath="/db_table"
        removeAction={removeDbTable}
      />
    </>
  );
}
