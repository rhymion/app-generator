import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getBookingListPageData } from '@/lib/booking/getters';
import { removeBooking } from '@/lib/booking/actions';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import BarChartIcon from '@mui/icons-material/BarChart';

export default function BookingListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <BookingListContent />
    </Suspense>
  );
}

async function BookingListContent() {
  const [t, tf, tc] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
    getTranslations('Common'),
  ]);
  const { bookings, userPermissions } = await getBookingListPageData();
  const formattedBookings = bookings.map(item => ({
    ...item,
    start_time: item.start_time ? new Date(item.start_time).toLocaleString('sv-SE') : '',
    end_time: item.end_time ? new Date(item.end_time).toLocaleString('sv-SE') : '',
  }));
  return (
    <>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <Button component={Link} href="/booking/chart" variant="outlined" startIcon={<BarChartIcon />}>
          {tc('chart')}
        </Button>
      </Box>
      <ResponsiveListClient
        entityLabel={t('booking')}
        src={formattedBookings}
        permissions={userPermissions}
        basePath="/booking"
        removeAction={removeBooking}
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 200 },
          { field: 'resource', headerName: tf('resource'), width: 200 },
          { field: 'start_time', headerName: tf('startTime'), width: 200 },
          { field: 'end_time', headerName: tf('endTime'), width: 200 }
        ]}
        primaryField="name"
      />
    </>
  );
}
