import { getProcedureListPageData } from '@/lib/procedure/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeProcedure } from '@/lib/procedure/actions';

export default async function ProceduresPage() {
  const { procedures, userPermissions } = await getProcedureListPageData();
  return <ResponsiveListClient src={procedures} basePath="/procedure" removeAction={removeProcedure} entityLabel="Procedure"
    permissions={userPermissions} />;
}
