import FormUpsert from '@/components/xxxxx_xxxxx/FormUpsert';
import { getXxxxxXxxxxDetail } from '@/lib/xxxxx_xxxxx/getters';
import { XxxxxXxxxxDetailPageProps } from '@/lib/xxxxx_xxxxx/types';
import { notFound } from 'next/navigation';

export default async function EditXxxxxXxxxxPage({ params }: XxxxxXxxxxDetailPageProps) {
  const { id } = await params;
  const xxxxx_xxxxx = await getXxxxxXxxxxDetail(id);
  if (!xxxxx_xxxxx) {
    notFound();
  }
  return <FormUpsert src={xxxxx_xxxxx} isEdit={true} />;
}
