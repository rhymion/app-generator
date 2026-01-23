import FormView from '@/components/xxxxx_xxxxx/FormView';
import { getXxxxxXxxxxDetail } from '@/lib/xxxxx_xxxxx/getters';
import { XxxxxXxxxxDetailPageProps } from '@/lib/xxxxx_xxxxx/types';
import { notFound } from 'next/navigation';

export default async function ViewXxxxxXxxxxPage({ params }: XxxxxXxxxxDetailPageProps) {
  const { id } = await params;
  const xxxxx_xxxxx = await getXxxxxXxxxxDetail(id);
  if (!xxxxx_xxxxx) {
    notFound();
  }
  return <FormView src={xxxxx_xxxxx} />;
}
