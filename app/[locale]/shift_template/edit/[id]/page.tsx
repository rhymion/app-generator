import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/shift_template/FormUpsert';
import { getShiftTemplateDetailPageData } from '@/lib/shift_template/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { ShiftTemplateDetailPageProps } from '@/lib/shift_template/types';
import { notFound } from 'next/navigation';

export default async function EditShiftTemplatePage({ params }: ShiftTemplateDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ShiftTemplateEditContent id={id} />
    </Suspense>
  );
}

async function ShiftTemplateEditContent({ id }: { id: string }) {
  const [detail, userAccountsData] = await Promise.all([
    getShiftTemplateDetailPageData(id, 'update'),
    getUserAccountListPageData(false),
  ]);
  if (!detail.shiftTemplate) {
    notFound();
  }
  return <FormUpsert src={detail.shiftTemplate} isEdit={true} permissions={detail.userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
