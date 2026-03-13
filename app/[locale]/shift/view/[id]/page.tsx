import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormView from '@/components/shift/FormView';
import { getShiftDetailPageData } from '@/lib/shift/getters';
import { ShiftDetailPageProps } from '@/lib/shift/types';
import { notFound } from 'next/navigation';

export default async function ViewShiftPage({ params }: ShiftDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <ShiftViewContent id={id} />
    </Suspense>
  );
}

async function ShiftViewContent({ id }: { id: string }) {
  const { shift, userPermissions } = await getShiftDetailPageData(id);
  if (!shift) {
    notFound();
  }
  return <FormView src={shift} permissions={userPermissions} />;
}
