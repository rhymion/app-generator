import FormView from '@/components/user_account/FormView';
import { getUserAccountDetail } from '@/lib/user_account/getters';
import { UserAccountDetailPageProps } from '@/lib/user_account/types';
import { notFound } from 'next/navigation';

export default async function ViewUserAccountPage({ params }: UserAccountDetailPageProps) {
  const { id } = await params;
  const user_account = await getUserAccountDetail(id);
  if (!user_account) {
    notFound();
  }
  return <FormView src={user_account} />;
}
