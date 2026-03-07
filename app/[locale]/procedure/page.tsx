import { getTranslations } from 'next-intl/server';
import { getProcedureListPageData } from '@/lib/procedure/getters';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { removeProcedure } from '@/lib/procedure/actions';

export default async function ProceduresPage() {
  const { procedures, userPermissions } = await getProcedureListPageData();
  const t = await getTranslations('EntityLabel');
  return <ResponsiveListClient src={procedures} basePath="/procedure" removeAction={removeProcedure} entityLabel={t('procedure')}
    permissions={userPermissions} />;
}
