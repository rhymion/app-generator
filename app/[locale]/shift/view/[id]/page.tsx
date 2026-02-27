import FormView from '@/components/shift/FormView';
import { getShiftDetailPageData } from '@/lib/shift/getters';
import { ShiftDetailPageProps } from '@/lib/shift/types';
import { notFound } from 'next/navigation';

export default async function ViewShiftPage({ params }: ShiftDetailPageProps) {
  const { id } = await params;
  const { shift, userPermissions } = await getShiftDetailPageData(id);
  if (!shift) {
    notFound();
  }
  return <FormView src={shift} permissions={userPermissions} />;
}
