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
  const t0 = performance.now();
  const [detail, userAccountsData] = await Promise.all([
    getShiftTemplateDetailPageData(id, 'update'),
    getUserAccountListPageData(false),
  ]);
  console.log(`Data fetching for page took ${performance.now() - t0} ms`);

  if (!detail.shiftTemplate) {
    notFound();
  }
  const form = <FormUpsert src={detail.shiftTemplate} isEdit={true} permissions={detail.userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
  console.log(`Rendering page took ${performance.now() - t0} ms`);
  return form;
}
