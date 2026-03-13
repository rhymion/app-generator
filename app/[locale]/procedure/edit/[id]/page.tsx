import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/procedure/FormUpsert';
import { getProcedureDetailPageData } from '@/lib/procedure/getters';
import { getProcedureListPageData } from '@/lib/procedure/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { ProcedureDetailPageProps } from '@/lib/procedure/types';
import { notFound } from 'next/navigation';

export default async function EditProcedurePage({ params }: ProcedureDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <ProcedureEditContent id={id} />
    </Suspense>
  );
}

async function ProcedureEditContent({ id }: { id: string }) {
  const [detail, proceduresData, userAccountsData] = await Promise.all([
    getProcedureDetailPageData(id, 'update'),
    getProcedureListPageData(false),
    getUserAccountListPageData(false),
  ]);
  if (!detail.procedure) {
    notFound();
  }
  return <FormUpsert src={detail.procedure} isEdit={true} permissions={detail.userPermissions} allProcedures={proceduresData.procedures} procedurePermissions={proceduresData.userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
