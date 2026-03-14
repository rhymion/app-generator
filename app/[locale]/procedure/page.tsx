import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getProcedureListPageData } from '@/lib/procedure/getters';
import { removeProcedure } from '@/lib/procedure/actions';

export default function ProcedureListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <ProcedureListContent />
    </Suspense>
  );
}

async function ProcedureListContent() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { procedures, userPermissions } = await getProcedureListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('procedure')}
        src={procedures}
        permissions={userPermissions}
        basePath="/procedure"
        removeAction={removeProcedure}
      />
    </>
  );
}
