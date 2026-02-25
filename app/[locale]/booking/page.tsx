import { getBookingListPageData } from '@/lib/booking/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeBooking } from '@/lib/booking/actions';

export default async function BookingsPage() {
  const { bookings, userPermissions } = await getBookingListPageData();
  return <ResponsiveListClient src={bookings} basePath="/booking" removeAction={removeBooking} entityLabel="Booking"
    permissions={userPermissions} />;
}
