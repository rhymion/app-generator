import FormUpsert from '@/components/xxxxx_xxxxx/FormUpsert';
import { getXxxxxXxxxxDetailPageData } from '@/lib/xxxxx_xxxxx/getters';
import { XxxxxXxxxxDetailPageProps } from '@/lib/xxxxx_xxxxx/types';
import { notFound } from 'next/navigation';

export default async function EditXxxxxXxxxxPage({ params }: XxxxxXxxxxDetailPageProps) {
  const { id } = await params;
  const detail = await getXxxxxXxxxxDetailPageData(id, 'update');
  if (!detail.xxxxxXxxxx) {
    notFound();
  }
  return <FormUpsert src={detail.xxxxxXxxxx} isEdit={true} />;
}
