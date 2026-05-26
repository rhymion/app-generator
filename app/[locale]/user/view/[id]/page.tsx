import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/user/FormView';
import { getUserDetailPageData } from '@/lib/user/getters';
import { UserDetailPageProps } from '@/lib/user/types';
import { notFound } from 'next/navigation';

export default async function ViewUserPage({ params }: UserDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <UserViewContent id={id} />
    </Suspense>
  );
}

async function UserViewContent({ id }: { id: string }) {
  const { user, userPermissions } = await getUserDetailPageData(id);
  if (!user) {
    notFound();
  }
  return <FormView src={user} permissions={userPermissions} />;
}
