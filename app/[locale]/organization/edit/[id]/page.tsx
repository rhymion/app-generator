import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/organization/FormUpsert';
import { getOrganizationDetailPageData } from '@/lib/organization/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { OrganizationDetailPageProps } from '@/lib/organization/types';
import { notFound } from 'next/navigation';

export default async function EditOrganizationPage({ params }: OrganizationDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <OrganizationEditContent id={id} />
    </Suspense>
  );
}

async function OrganizationEditContent({ id }: { id: string }) {
  const [detail, userAccountsData] = await Promise.all([
    getOrganizationDetailPageData(id, 'update'),
    getUserAccountListPageData(false),
  ]);
  if (!detail.organization) {
    notFound();
  }
  return <FormUpsert src={detail.organization} isEdit={true} permissions={detail.userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
