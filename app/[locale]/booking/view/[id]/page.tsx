import FormView from '@/components/booking/FormView';
import { getBookingDetailPageData } from '@/lib/booking/getters';
import { BookingDetailPageProps } from '@/lib/booking/types';
import { notFound } from 'next/navigation';

export default async function ViewBookingPage({ params }: BookingDetailPageProps) {
  const { id } = await params;
  const { booking, userPermissions } = await getBookingDetailPageData(id);
  if (!booking) {
    notFound();
  }
  return <FormView src={booking} permissions={userPermissions} />;
}
