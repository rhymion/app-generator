import FormUpsert from '@/components/user_account/FormUpsert';
import { getUserAccountEditPageData } from '@/lib/user_account/getters';
import { UserAccountDetailPageProps } from '@/lib/user_account/types';
import { notFound } from 'next/navigation';

export default async function EditUserAccountPage({ params }: UserAccountDetailPageProps) {
  const { id } = await params;
  const data = await getUserAccountEditPageData(id);
  if (!data) {
    notFound();
  }
  return (
    <FormUpsert
      src={data.userAccount}
      isEdit={true}
      allRoles={data.allRoles}
      allowRoleEdit={data.canAssignRoles}
    />
  );
}
