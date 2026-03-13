import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/booking/FormView';
import { getBookingDetailPageData } from '@/lib/booking/getters';
import { BookingDetailPageProps } from '@/lib/booking/types';
import { notFound } from 'next/navigation';

export default async function ViewBookingPage({ params }: BookingDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <BookingViewContent id={id} />
    </Suspense>
  );
}

async function BookingViewContent({ id }: { id: string }) {
  const { booking, userPermissions } = await getBookingDetailPageData(id);
  if (!booking) {
    notFound();
  }
  return <FormView src={booking} permissions={userPermissions} />;
}
