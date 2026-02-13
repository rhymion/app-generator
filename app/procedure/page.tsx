import { getProcedureListPageData } from '@/lib/procedure/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeProcedure } from '@/lib/procedure/actions';

export default async function ProceduresPage() {
  const { procedures, userPermissions } = await getProcedureListPageData();
  return <DataGridClient src={procedures} basePath="/procedure" removeAction={removeProcedure} entityLabel="Procedure"
    permissions={userPermissions} />;
}
