import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/shift/FormUpsert';
import { getShiftDetailPageData } from '@/lib/shift/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { ShiftDetailPageProps } from '@/lib/shift/types';
import { notFound } from 'next/navigation';

export default async function EditShiftPage({ params }: ShiftDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <ShiftEditContent id={id} />
    </Suspense>
  );
}

async function ShiftEditContent({ id }: { id: string }) {
  const [detail, userAccountsData] = await Promise.all([
    getShiftDetailPageData(id, 'update'),
    getUserAccountListPageData(false),
  ]);
  if (!detail.shift) {
    notFound();
  }
  return <FormUpsert src={detail.shift} isEdit={true} permissions={detail.userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
