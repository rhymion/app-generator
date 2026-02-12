import { getBookingListPageData } from '@/lib/booking/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeBooking } from '@/lib/booking/actions';

export default async function BookingsPage() {
  const { bookings, userPermissions } = await getBookingListPageData();
  return <DataGridClient src={bookings} basePath="/booking" removeAction={removeBooking} entityLabel="Booking"
    permissions={userPermissions} />;
}
