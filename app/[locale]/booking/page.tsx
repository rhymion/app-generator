import { getTranslations } from 'next-intl/server';
import { getBookingListPageData } from '@/lib/booking/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeBooking } from '@/lib/booking/actions';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import BarChartIcon from '@mui/icons-material/BarChart';

export default async function BookingsPage() {
  const { bookings, userPermissions } = await getBookingListPageData();
  const [t, tf, tc] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
    getTranslations('Common'),
  ]);
  const formattedBookings = bookings.map(item => ({
    ...item,
    start_time: item.start_time ? new Date(item.start_time).toLocaleString('sv-SE') : '',
    end_time: item.end_time ? new Date(item.end_time).toLocaleString('sv-SE') : '',
  }));
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
        <Link href="/booking/chart" underline="none">
          <Button variant="outlined" size="medium" startIcon={<BarChartIcon />}>{tc('chart')}</Button>
        </Link>
      </Box>
      <ResponsiveListClient src={formattedBookings} basePath="/booking" removeAction={removeBooking} entityLabel={t('booking')} primaryField="name" displayFields={[
    { field: 'name', headerName: tf('name'), width: 200 },
    { field: 'resource', headerName: tf('resource'), width: 200 },
    { field: 'start_time', headerName: tf('startTime'), width: 200 },
    { field: 'end_time', headerName: tf('endTime'), width: 200 }
  ]}
        permissions={userPermissions} />
    </Box>
  );
}
