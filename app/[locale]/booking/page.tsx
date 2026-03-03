import { getBookingListPageData } from '@/lib/booking/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeBooking } from '@/lib/booking/actions';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import BarChartIcon from '@mui/icons-material/BarChart';

export default async function BookingsPage() {
  const { bookings, userPermissions } = await getBookingListPageData();
  const formattedBookings = bookings.map(item => ({
    ...item,
    start_time: item.start_time ? new Date(item.start_time).toLocaleString('sv-SE') : '',
    end_time: item.end_time ? new Date(item.end_time).toLocaleString('sv-SE') : '',
  }));
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
        <Link href="/booking/chart" underline="none">
          <Button variant="outlined" size="medium" startIcon={<BarChartIcon />}>Chart</Button>
        </Link>
      </Box>
      <ResponsiveListClient src={formattedBookings} basePath="/booking" removeAction={removeBooking} entityLabel="Booking" primaryField="name" displayFields={[
    { field: 'name', headerName: 'Name', width: 200 },
    { field: 'resource', headerName: 'Resource', width: 200 },
    { field: 'start_time', headerName: 'Start Time', width: 200 },
    { field: 'end_time', headerName: 'End Time', width: 200 }
  ]}
        permissions={userPermissions} />
    </Box>
  );
}
