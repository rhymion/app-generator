import FormView from '@/components/user_account/FormView';
import { getUserAccountDetailPageData } from '@/lib/user_account/getters';
import { UserAccountDetailPageProps } from '@/lib/user_account/types';
import { notFound } from 'next/navigation';

export default async function ViewUserAccountPage({ params }: UserAccountDetailPageProps) {
  const { id } = await params;
  const data = await getUserAccountDetailPageData(id);
  if (!data) {
    notFound();
  }
  return <FormView src={data.userAccount} permissions={data.permissions} />;
}
