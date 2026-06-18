import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/organization/FormUpsert';
import { getOrganizationDetailPageData } from '@/lib/organization/getters';
import { searchUserOptions } from '@/lib/user/getters';
import { OrganizationDetailPageProps } from '@/lib/organization/types';
import { notFound } from 'next/navigation';

export default async function EditOrganizationPage({ params }: OrganizationDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <OrganizationEditContent id={id} />
    </Suspense>
  );
}

async function OrganizationEditContent({ id }: { id: string }) {
  const [detail, initialUsers] = await Promise.all([
    getOrganizationDetailPageData(id, 'update'),
    searchUserOptions('', [], 50),
  ]);
  if (!detail.organization) {
    notFound();
  }
  return <FormUpsert src={detail.organization} isEdit={true} permissions={detail.userPermissions} initialUsers={ initialUsers } searchUserOptions={ searchUserOptions } />;
}
