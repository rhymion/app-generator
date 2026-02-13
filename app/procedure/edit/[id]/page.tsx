import FormUpsert from '@/components/procedure/FormUpsert';
import { getProcedureDetailPageData } from '@/lib/procedure/getters';
import { getProcedureListPageData } from '@/lib/procedure/getters';
import { ProcedureDetailPageProps } from '@/lib/procedure/types';
import { notFound } from 'next/navigation';

export default async function EditProcedurePage({ params }: ProcedureDetailPageProps) {
  const { id } = await params;
  const [detail, proceduresData] = await Promise.all([
    getProcedureDetailPageData(id, 'update'),
    getProcedureListPageData(false),
  ]);
  if (!detail.procedure) {
    notFound();
  }
  return <FormUpsert src={detail.procedure} isEdit={true} permissions={detail.userPermissions} allProcedures={proceduresData.procedures} procedurePermissions={proceduresData.userPermissions} />;
}
