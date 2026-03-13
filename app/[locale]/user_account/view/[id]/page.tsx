import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormView from '@/components/user_account/FormView';
import { getUserAccountDetailPageData } from '@/lib/user_account/getters';
import { UserAccountDetailPageProps } from '@/lib/user_account/types';
import { notFound } from 'next/navigation';

export default async function ViewUserAccountPage({ params }: UserAccountDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <UserAccountViewContent id={id} />
    </Suspense>
  );
}

async function UserAccountViewContent({ id }: { id: string }) {
  const { userAccount, userPermissions } = await getUserAccountDetailPageData(id);
  if (!userAccount) {
    notFound();
  }
  return <FormView src={userAccount} permissions={userPermissions} />;
}
